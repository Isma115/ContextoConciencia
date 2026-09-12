const fs = require('node:fs');
const path = require('node:path');
const { parseJson } = require('../database/db');
const { upsertDocument } = require('../services/documents');
const { detectFileType } = require('../services/media-detection');

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
  ['.cjs', 'javascript'],
  // Multimedia: se indexan por metadatos y se sirven en streaming desde su archivo original.
  ['.png', 'image'],
  ['.jpg', 'image'],
  ['.jpeg', 'image'],
  ['.webp', 'image'],
  ['.avif', 'image'],
  ['.bmp', 'image'],
  ['.tif', 'image'],
  ['.tiff', 'image'],
  ['.svg', 'image'],
  ['.gif', 'gif'],
  ['.mp4', 'video'],
  ['.m4v', 'video'],
  ['.webm', 'video'],
  ['.ogv', 'video'],
  ['.mov', 'video'],
  ['.mp3', 'audio'],
  ['.mpga', 'audio'],
  ['.wav', 'audio'],
  ['.wave', 'audio'],
  ['.oga', 'audio'],
  ['.ogg', 'audio'],
  ['.opus', 'audio'],
  ['.m4a', 'audio'],
  ['.m4b', 'audio'],
  ['.aac', 'audio'],
  ['.flac', 'audio'],
  ['.weba', 'audio'],
  ['.wma', 'audio'],
  ['.aiff', 'audio'],
  ['.aif', 'audio'],
  ['.aifc', 'audio'],
  ['.au', 'audio'],
  ['.snd', 'audio'],
  ['.amr', 'audio'],
  ['.3gp', 'audio'],
  ['.caf', 'audio'],
  ['.mka', 'audio'],
  ['.mp2', 'audio'],
  ['.mpa', 'audio'],
  ['.ac3', 'audio'],
  ['.dts', 'audio'],
  ['.eac3', 'audio'],
  ['.gsm', 'audio'],
  ['.ra', 'audio'],
  ['.ram', 'audio'],
  ['.voc', 'audio'],
  ['.ape', 'audio'],
  ['.wv', 'audio'],
  ['.tta', 'audio'],
  ['.dsf', 'audio'],
  ['.dff', 'audio'],
  ['.mid', 'audio'],
  ['.midi', 'audio'],
  ['.kar', 'audio']
]);
const DOCUMENT_SUPPORTED = new Map([...SUPPORTED].filter(([, type]) => !['css', 'javascript'].includes(type)));
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 2000;
const BINARY_SAMPLE_BYTES = 8192;

const MEDIA_BY_EXTENSION = new Map([
  ['.png', { type: 'image', kind: 'image', mime: 'image/png' }],
  ['.jpg', { type: 'image', kind: 'image', mime: 'image/jpeg' }],
  ['.jpeg', { type: 'image', kind: 'image', mime: 'image/jpeg' }],
  ['.webp', { type: 'image', kind: 'image', mime: 'image/webp' }],
  ['.avif', { type: 'image', kind: 'image', mime: 'image/avif' }],
  ['.bmp', { type: 'image', kind: 'image', mime: 'image/bmp' }],
  ['.tif', { type: 'image', kind: 'image', mime: 'image/tiff' }],
  ['.tiff', { type: 'image', kind: 'image', mime: 'image/tiff' }],
  ['.svg', { type: 'image', kind: 'image', mime: 'image/svg+xml' }],
  ['.gif', { type: 'gif', kind: 'image', mime: 'image/gif' }],
  ['.mp4', { type: 'video', kind: 'video', mime: 'video/mp4' }],
  ['.m4v', { type: 'video', kind: 'video', mime: 'video/x-m4v' }],
  ['.webm', { type: 'video', kind: 'video', mime: 'video/webm' }],
  ['.ogv', { type: 'video', kind: 'video', mime: 'video/ogg' }],
  ['.mov', { type: 'video', kind: 'video', mime: 'video/quicktime' }],
  ['.mp3', { type: 'audio', kind: 'audio', mime: 'audio/mpeg' }],
  ['.mpga', { type: 'audio', kind: 'audio', mime: 'audio/mpeg' }],
  ['.wav', { type: 'audio', kind: 'audio', mime: 'audio/wav' }],
  ['.wave', { type: 'audio', kind: 'audio', mime: 'audio/wav' }],
  ['.oga', { type: 'audio', kind: 'audio', mime: 'audio/ogg' }],
  ['.ogg', { type: 'audio', kind: 'audio', mime: 'audio/ogg' }],
  ['.opus', { type: 'audio', kind: 'audio', mime: 'audio/opus' }],
  ['.m4a', { type: 'audio', kind: 'audio', mime: 'audio/mp4' }],
  ['.m4b', { type: 'audio', kind: 'audio', mime: 'audio/mp4' }],
  ['.aac', { type: 'audio', kind: 'audio', mime: 'audio/aac' }],
  ['.flac', { type: 'audio', kind: 'audio', mime: 'audio/flac' }],
  ['.weba', { type: 'audio', kind: 'audio', mime: 'audio/webm' }],
  ['.wma', { type: 'audio', kind: 'audio', mime: 'audio/x-ms-wma' }],
  ['.aiff', { type: 'audio', kind: 'audio', mime: 'audio/aiff' }],
  ['.aif', { type: 'audio', kind: 'audio', mime: 'audio/aiff' }],
  ['.aifc', { type: 'audio', kind: 'audio', mime: 'audio/aiff' }],
  ['.au', { type: 'audio', kind: 'audio', mime: 'audio/basic' }],
  ['.snd', { type: 'audio', kind: 'audio', mime: 'audio/basic' }],
  ['.amr', { type: 'audio', kind: 'audio', mime: 'audio/amr' }],
  ['.3gp', { type: 'audio', kind: 'audio', mime: 'audio/3gpp' }],
  ['.caf', { type: 'audio', kind: 'audio', mime: 'audio/x-caf' }],
  ['.mka', { type: 'audio', kind: 'audio', mime: 'audio/x-matroska' }],
  ['.mp2', { type: 'audio', kind: 'audio', mime: 'audio/mpeg' }],
  ['.mpa', { type: 'audio', kind: 'audio', mime: 'audio/mpeg' }],
  ['.ac3', { type: 'audio', kind: 'audio', mime: 'audio/ac3' }],
  ['.dts', { type: 'audio', kind: 'audio', mime: 'audio/vnd.dts' }],
  ['.eac3', { type: 'audio', kind: 'audio', mime: 'audio/eac3' }],
  ['.gsm', { type: 'audio', kind: 'audio', mime: 'audio/gsm' }],
  ['.ra', { type: 'audio', kind: 'audio', mime: 'audio/x-realaudio' }],
  ['.ram', { type: 'audio', kind: 'audio', mime: 'audio/x-pn-realaudio' }],
  ['.voc', { type: 'audio', kind: 'audio', mime: 'audio/x-voc' }],
  ['.ape', { type: 'audio', kind: 'audio', mime: 'audio/x-ape' }],
  ['.wv', { type: 'audio', kind: 'audio', mime: 'audio/wavpack' }],
  ['.tta', { type: 'audio', kind: 'audio', mime: 'audio/x-tta' }],
  ['.dsf', { type: 'audio', kind: 'audio', mime: 'audio/x-dsf' }],
  ['.dff', { type: 'audio', kind: 'audio', mime: 'audio/x-dff' }],
  ['.mid', { type: 'audio', kind: 'audio', mime: 'audio/midi' }],
  ['.midi', { type: 'audio', kind: 'audio', mime: 'audio/midi' }],
  ['.kar', { type: 'audio', kind: 'audio', mime: 'audio/midi' }]
]);
const MAX_MEDIA_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_MEDIA_VIDEO_BYTES = 200 * 1024 * 1024;
const MAX_MEDIA_AUDIO_BYTES = 200 * 1024 * 1024;

function mediaForPath(filePath) {
  const extensionMedia = MEDIA_BY_EXTENSION.get(path.extname(filePath).toLowerCase());
  if (extensionMedia) return extensionMedia;
  try {
    const detected = detectFileType(filePath, { fileName: filePath });
    if (!['image', 'video', 'audio'].includes(detected.kind)) return null;
    return { type: detected.kind, kind: detected.kind, mime: detected.mime };
  } catch {
    return null;
  }
}

function detectedMediaForPath(filePath) {
  try {
    const detected = detectFileType(filePath, { fileName: filePath });
    if (!['image', 'video', 'audio'].includes(detected.kind)) return null;
    return detected;
  } catch {
    return null;
  }
}

function mediaByteLimit(media) {
  if (media.kind === 'video') return MAX_MEDIA_VIDEO_BYTES;
  if (media.kind === 'audio') return MAX_MEDIA_AUDIO_BYTES;
  return MAX_MEDIA_IMAGE_BYTES;
}

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
    if (scanOptions.includeUnsupported || DOCUMENT_SUPPORTED.has(path.extname(absolute).toLowerCase()) || detectedMediaForPath(absolute)) files.push(absolute);
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

function collectFilesFromInputs(inputs, options, errors) {
  const filesByInput = [];
  for (const input of inputs) {
    const inputFiles = [];
    try {
      collectFiles(input, inputFiles, options);
    } catch (error) {
      errors.push({ path: input, message: error.message });
    }
    filesByInput.push(inputFiles);
  }

  // Reparte el límite entre las rutas: una carpeta grande no debe impedir
  // que las siguientes rutas comunes aporten documentos al índice.
  const uniqueFiles = [];
  const seen = new Set();
  for (let index = 0; uniqueFiles.length < MAX_FILES; index += 1) {
    let hasFiles = false;
    for (const inputFiles of filesByInput) {
      const filePath = inputFiles[index];
      if (!filePath) continue;
      hasFiles = true;
      if (seen.has(filePath)) continue;
      seen.add(filePath);
      uniqueFiles.push(filePath);
      if (uniqueFiles.length >= MAX_FILES) break;
    }
    if (!hasFiles) break;
  }
  return uniqueFiles;
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

function readFileDocument(filePath, { allowLargeMetadata = false, deferContent = false } = {}) {
  const extension = path.extname(filePath).toLowerCase();
  const type = SUPPORTED.get(extension) || (extension ? extension.slice(1) : 'file');
  const stats = fs.statSync(filePath);
  const baseName = path.basename(filePath, extension);
  let metadata = {
    extension: extension.slice(1),
    size: stats.size,
    modifiedAt: stats.mtime.toISOString()
  };
  const knownMedia = MEDIA_BY_EXTENSION.get(extension);
  const detected = (knownMedia || !SUPPORTED.has(extension)) ? detectedMediaForPath(filePath) : null;
  const media = detected
    ? { type: knownMedia?.type === 'gif' ? 'gif' : detected.kind, kind: detected.kind, mime: detected.mime }
    : knownMedia;
  if (media) {
    metadata = { ...metadata, mediaKind: media.kind, mediaMime: media.mime, searchTitleOnly: true, contentLoaded: true, mediaDetectedBy: detected?.detectedBy || 'extension' };
    if (stats.size > mediaByteLimit(media)) metadata = { ...metadata, contentSkipped: 'too-large' };
    return {
      externalId: filePath,
      title: baseName.replace(/[-_]+/g, ' '),
      content: '',
      type: media.type,
      path: filePath,
      metadata
    };
  }
  if (stats.size > MAX_FILE_BYTES && !allowLargeMetadata && !deferContent) {
    throw new Error(`El archivo supera el límite de ${MAX_FILE_BYTES / 1024 / 1024} MB`);
  }
  let content = '';
  if (deferContent) {
    if (stats.size > MAX_FILE_BYTES) metadata = { ...metadata, contentSkipped: 'too-large' };
    metadata = { ...metadata, contentDeferred: true };
  } else if (stats.size > MAX_FILE_BYTES) {
    metadata = { ...metadata, contentSkipped: 'too-large', searchTitleOnly: true };
  } else {
    const buffer = fs.readFileSync(filePath);
    if (isProbablyBinary(buffer)) {
      metadata = { ...metadata, binary: true, searchTitleOnly: true };
    } else {
      content = buffer.toString('utf8');
    }
  }
  if (!deferContent && type === 'json') {
    try {
      const parsed = JSON.parse(content);
      metadata = { ...metadata, jsonKind: Array.isArray(parsed) ? 'array' : 'object', keys: parsed && !Array.isArray(parsed) && typeof parsed === 'object' ? Object.keys(parsed).slice(0, 50) : [] };
    } catch {
      metadata = { ...metadata, parseError: 'JSON no válido' };
    }
  }
  if (!deferContent && type === 'csv') metadata = { ...metadata, ...parseCsvSummary(content) };
  if (!deferContent) metadata = { ...metadata, contentLoaded: true };
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
  const errors = [];
  const scanOptions = {
    skipDirectories: config.excludeDirectories,
    ignoreErrors: config.ignoreErrors === true,
    followSymlinks: config.followSymlinks,
    includeUnsupported
  };
  const uniqueFiles = collectFilesFromInputs(inputs, scanOptions, errors);
  let created = 0;
  let updated = 0;
  db.transaction(() => {
    for (const filePath of uniqueFiles) {
      try {
        const indexed = readFileDocument(filePath, { allowLargeMetadata: scanOptions.includeUnsupported, deferContent: true });
        const existing = db.get(
          'SELECT content, metadata_json FROM documents WHERE source_id = ? AND external_id = ?',
          source.id,
          filePath
        );
        const previousMetadata = parseJson(existing?.metadata_json);
        if (existing && previousMetadata.contentDeferred !== true && previousMetadata.modifiedAt === indexed.metadata.modifiedAt) {
          indexed.content = existing.content;
          indexed.metadata = { ...previousMetadata, ...indexed.metadata, contentDeferred: false, contentLoaded: true };
        }
        const result = upsertDocument(db, source.id, indexed);
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

module.exports = { SUPPORTED, DOCUMENT_SUPPORTED, MAX_FILE_BYTES, MAX_FILES, MEDIA_BY_EXTENSION, collectFiles, mediaForPath, mediaByteLimit, readFileDocument, importLocalSource };
