const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { detectFileType, probeFile } = require('../services/media-detection');
const { transcodeAudioToMp3 } = require('../services/media-transcode');

const ID = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const SPEC_STATUSES = Object.freeze(['active', 'implemented']);
const SPEC_STATUS_BY_LABEL = Object.freeze({
  active: 'active', activa: 'active', implemented: 'implemented', implementada: 'implemented',
  // Compatibilidad de lectura: los estados retirados pasan a Activa.
  draft: 'active', borrador: 'active', approved: 'active', aprobada: 'active'
});
const SPEC_CARD_COLORS = Object.freeze([
  'red', 'coral', 'orange', 'amber', 'yellow', 'lime', 'green', 'teal',
  'cyan', 'blue', 'indigo', 'violet', 'purple', 'fuchsia', 'pink', 'rose'
]);
const SPEC_CARD_COLOR_LABELS = Object.freeze({
  red: 'Rojo', coral: 'Coral', orange: 'Naranja', amber: 'Ámbar',
  yellow: 'Amarillo', lime: 'Lima', green: 'Verde', teal: 'Turquesa',
  cyan: 'Cian', blue: 'Azul', indigo: 'Índigo', violet: 'Violeta',
  purple: 'Morado', fuchsia: 'Fucsia', pink: 'Rosa', rose: 'Rosado'
});
const SPEC_CARD_COLOR_BY_LABEL = Object.freeze({
  rojo: 'red', red: 'red', coral: 'coral', naranja: 'orange', orange: 'orange',
  ambar: 'amber', amber: 'amber', amarillo: 'yellow', yellow: 'yellow',
  lima: 'lime', lime: 'lime', verde: 'green', green: 'green', turquesa: 'teal', teal: 'teal',
  cian: 'cyan', cyan: 'cyan', azul: 'blue', blue: 'blue', indigo: 'indigo',
  violeta: 'violet', violet: 'violet', morado: 'purple', purpura: 'purple', purple: 'purple',
  fucsia: 'fuchsia', fuchsia: 'fuchsia', rosa: 'pink', pink: 'pink', rosado: 'rose', rose: 'rose'
});
const MEDIA_KINDS = Object.freeze(['text', 'image', 'video', 'audio']);
const MEDIA_MIME_BY_EXTENSION = Object.freeze({
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  mpga: 'audio/mpeg',
  wav: 'audio/wav',
  wave: 'audio/wav',
  oga: 'audio/ogg',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  m4a: 'audio/mp4',
  m4b: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  weba: 'audio/webm',
  wma: 'audio/x-ms-wma',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  aifc: 'audio/aiff',
  au: 'audio/basic',
  snd: 'audio/basic',
  amr: 'audio/amr',
  '3gp': 'audio/3gpp',
  caf: 'audio/x-caf',
  mka: 'audio/x-matroska',
  mp2: 'audio/mpeg',
  mpa: 'audio/mpeg',
  ac3: 'audio/ac3',
  dts: 'audio/vnd.dts',
  eac3: 'audio/eac3',
  gsm: 'audio/gsm',
  ra: 'audio/x-realaudio',
  ram: 'audio/x-pn-realaudio',
  voc: 'audio/x-voc',
  ape: 'audio/x-ape',
  wv: 'audio/wavpack',
  tta: 'audio/x-tta',
  dsf: 'audio/x-dsf',
  dff: 'audio/x-dff',
  mid: 'audio/midi',
  midi: 'audio/midi',
  kar: 'audio/midi'
});
const IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
const AUDIO_MAX_BYTES = 100 * 1024 * 1024;
const RESOURCE_MAX_BYTES = 200 * 1024 * 1024;
const TEXT_MAX_LENGTH = 20000;
// La estructura S.D.D. es siempre <proyecto>/SDD_specs. Las especificaciones
// vigentes viven en snapshots versionados bajo `specs/`; `specs.md` solo se
// conserva como nombre del formato legado que puede migrarse desde la interfaz.
const SDD_FOLDER_NAME = 'SDD_specs';
const SDD_SPECS_DIRECTORY = 'specs';
const SDD_LEGACY_SPECS_FILENAME = 'specs.md';
const SDD_FULL_FILENAME = 'specs_full.md';
const SDD_DATABASE_FILENAME = 'bbdd.md';
const SDD_RESOURCES_DIRECTORY = 'specs_resources';
const resourceProbeCache = new Map();
const RESOURCE_PROBE_CACHE_LIMIT = 512;
const SDD_METADATA_MARKERS = Object.freeze({
  database: Object.freeze({
    start: '<!-- nexusdata:sdd-database:start -->',
    end: '<!-- nexusdata:sdd-database:end -->'
  }),
  ui: Object.freeze({
    start: '<!-- nexusdata:sdd-ui:start -->',
    end: '<!-- nexusdata:sdd-ui:end -->'
  })
});

function asText(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function sliceText(value, maxLength) {
  return String(value ?? '').slice(0, maxLength);
}

function asBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    if (['true', '1', 'yes', 'sí', 'si'].includes(value.trim().toLowerCase())) return true;
    if (['false', '0', 'no'].includes(value.trim().toLowerCase())) return false;
  }
  return fallback;
}

function stableId(prefix, value) {
  const digest = crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24);
  return `${prefix}_${digest}`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function metadataPattern(kind) {
  const marker = SDD_METADATA_MARKERS[kind];
  return new RegExp(`${escapeRegExp(marker.start)}[\\s\\S]*?${escapeRegExp(marker.end)}`, 'g');
}

// Compatibilidad de lectura para proyectos creados con el formato JSON heredado.
function extractSddMetadata(markdown, kind) {
  const marker = SDD_METADATA_MARKERS[kind];
  const source = String(markdown ?? '');
  const start = source.indexOf(marker.start);
  const end = source.indexOf(marker.end);
  if (start < 0 && end < 0) return null;
  if (start < 0 || end < 0 || end < start) {
    throw new Error(`El bloque de metadatos S.D.D. (${kind}) está incompleto en specs.md`);
  }
  const content = source.slice(start + marker.start.length, end).trim();
  if (!content) return {};
  try {
    return JSON.parse(content);
  } catch {
    throw new Error(`El bloque de metadatos S.D.D. (${kind}) no contiene JSON válido`);
  }
}

function stripSddMetadata(markdown) {
  let clean = String(markdown ?? '');
  for (const kind of Object.keys(SDD_METADATA_MARKERS)) {
    extractSddMetadata(clean, kind);
    clean = clean.replace(metadataPattern(kind), '');
  }
  return clean.replace(/\n{3,}/g, '\n\n');
}

function normalizeDatabase(value) {
  const rawTables = Array.isArray(value?.tables) ? value.tables : [];
  const tables = rawTables.map((rawTable, tableIndex) => {
    const name = sliceText(asText(rawTable?.name), 120);
    const id = asText(rawTable?.id) || stableId('sdd_table', tableIndex);
    const rawColumns = Array.isArray(rawTable?.columns) ? rawTable.columns : [];
    const columns = rawColumns.map((rawColumn, columnIndex) => {
      const columnName = sliceText(asText(rawColumn?.name), 120);
      return {
        id: asText(rawColumn?.id) || stableId('sdd_column', `${id}:${columnIndex}`),
        name: columnName,
        type: sliceText(asText(rawColumn?.type), 60),
        nullable: asBoolean(rawColumn?.nullable, true),
        primaryKey: asBoolean(rawColumn?.primaryKey, false),
        defaultValue: sliceText(rawColumn?.defaultValue, 200),
        description: sliceText(rawColumn?.description, 1000),
        position: Number.isFinite(Number(rawColumn?.position)) ? Number(rawColumn.position) : columnIndex
      };
    });
    return {
      id,
      name,
      description: sliceText(rawTable?.description, 2000),
      createdAt: asText(rawTable?.createdAt) || null,
      updatedAt: asText(rawTable?.updatedAt) || null,
      columns
    };
  });
  return { version: 1, tables };
}

function normalizeMedia(value) {
  const rawMedia = Array.isArray(value?.media) ? value.media : [];
  const media = rawMedia.map((rawItem, index) => {
    const kind = MEDIA_KINDS.includes(rawItem?.kind) ? rawItem.kind : 'text';
    const title = sliceText(asText(rawItem?.title), 200);
    return {
      id: asText(rawItem?.id) || stableId('media', index),
      title,
      description: sliceText(rawItem?.description, 5000),
      kind,
      content: kind === 'text' ? sliceText(rawItem?.content, TEXT_MAX_LENGTH) : '',
      fileName: kind === 'text' ? '' : asText(rawItem?.fileName),
      createdAt: asText(rawItem?.createdAt) || null,
      updatedAt: asText(rawItem?.updatedAt) || null
    };
  });
  return { version: 1, media };
}

function specForResponse(row, index = 0, timestamp = null) {
  return {
    id: row.id || stableId('spec', index),
    title: row.title,
    description: row.description,
    status: normalizeSpecStatus(row.status),
    category: row.category,
    color: normalizeSpecCardColor(row.color),
    createdAt: row.createdAt || row.created_at || timestamp,
    updatedAt: row.updatedAt || row.updated_at || timestamp
  };
}

function specsWithIdentity(specs, timestamp = null) {
  return specs.map((spec, index) => specForResponse({ ...spec, id: spec.id || stableId('spec', index) }, index, timestamp));
}

function columnForResponse(column, tableId) {
  return {
    id: column.id,
    tableId,
    name: column.name,
    type: column.type,
    nullable: Boolean(column.nullable),
    primaryKey: Boolean(column.primaryKey),
    defaultValue: column.defaultValue,
    description: column.description,
    position: Number(column.position)
  };
}

function tableForResponse(table) {
  return {
    id: table.id,
    name: table.name,
    description: table.description,
    createdAt: table.createdAt,
    updatedAt: table.updatedAt,
    columns: [...table.columns]
      .sort((a, b) => Number(a.position) - Number(b.position) || a.id.localeCompare(b.id))
      .map((column) => columnForResponse(column, table.id))
  };
}

function resourceUrl(projectPath, fileName, endpoint = 'resources/file') {
  const query = new URLSearchParams({
    projectPath: String(projectPath || ''),
    fileName: String(fileName || '')
  });
  return `/api/sdd/${endpoint}?${query.toString()}`;
}

function sddMediaFileUrl(projectPath, mediaId) {
  const query = new URLSearchParams({ projectPath: String(projectPath || '') });
  return `/api/sdd/media/${encodeURIComponent(String(mediaId || ''))}/file?${query.toString()}`;
}

function mediaForResponse(item, projectPath) {
  const response = {
    id: item.id,
    title: item.title,
    description: item.description,
    kind: item.kind,
    content: item.content,
    fileName: item.fileName || null,
    fileUrl: null,
    transcodeUrl: null,
    fileType: null,
    fileMissing: false,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
  if (!item.fileName) return response;
  try {
    const filePath = safeResourcePath(projectPath, item.fileName);
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) throw new Error('No es un archivo');
    const detected = detectFileType(filePath, { fileName: item.fileName });
    response.fileType = detected.mime;
    response.fileUrl = sddMediaFileUrl(projectPath, item.id);
    if (detected.kind === 'audio' || item.kind === 'audio') response.transcodeUrl = `${response.fileUrl}&transcode=1`;
  } catch {
    response.fileMissing = true;
  }
  return response;
}

function specInput(body, existing = null) {
  const title = asText(body?.title, existing?.title || '').slice(0, 200);
  if (!title) throw new Error('Indica un título para la especificación');
  const hasStatus = Object.prototype.hasOwnProperty.call(body || {}, 'status');
  if (hasStatus && !SPEC_STATUSES.includes(body.status)) throw new Error('El estado de la especificación no es válido');
  const hasColor = Object.prototype.hasOwnProperty.call(body || {}, 'color');
  return {
    title,
    description: sliceText(body?.description, 10000),
    status: hasStatus ? body.status : normalizeSpecStatus(existing?.status),
    category: asText(body?.category).slice(0, 60),
    color: hasColor ? specCardColorInput(body.color) : normalizeSpecCardColor(existing?.color)
  };
}

function specChanges(body = {}) {
  const changes = {};
  if (Object.prototype.hasOwnProperty.call(body, 'status')) {
    if (!SPEC_STATUSES.includes(body.status)) throw new Error('El estado de la especificación no es válido');
    changes.status = body.status;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'category')) changes.category = asText(body.category).slice(0, 60);
  if (Object.prototype.hasOwnProperty.call(body, 'description')) changes.description = sliceText(body.description, 10000);
  if (Object.prototype.hasOwnProperty.call(body, 'color')) changes.color = specCardColorInput(body.color);
  if (!Object.keys(changes).length) throw new Error('Indica al menos un cambio para aplicar');
  return changes;
}

function normalizeSpecValue(raw, map, fallback) {
  const value = String(raw || '').trim().toLowerCase();
  return value ? (map[value] || fallback) : fallback;
}

const SPEC_STATUS_LABELS = Object.freeze({ active: 'Activa', implemented: 'Implementada' });

function normalizeSpecStatus(value, fallback = 'active') {
  return normalizeSpecValue(value, SPEC_STATUS_BY_LABEL, fallback);
}

function normalizeMarkdownLabel(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeSpecCardColor(value, fallback = '') {
  const normalized = normalizeMarkdownLabel(value);
  if (!normalized) return fallback;
  if (SPEC_CARD_COLORS.includes(normalized)) return normalized;
  return SPEC_CARD_COLOR_BY_LABEL[normalized] || fallback;
}

function specCardColorInput(value) {
  if (!asText(value)) return '';
  const color = normalizeSpecCardColor(value);
  if (!color) throw new Error('El color de la tarjeta no es válido');
  return color;
}

function cleanMarkdownValue(value) {
  return String(value ?? '')
    .trim()
    .replace(/^`([\s\S]*)`$/, '$1')
    .replace(/\*\*/g, '')
    .replace(/\\([|`])/g, '$1')
    .trim();
}

function markdownSectionName(heading) {
  const value = normalizeMarkdownLabel(cleanMarkdownValue(heading));
  if (['specs', 'requisitos', 'especificaciones'].includes(value)) return 'specs';
  if (['bbdd', 'base de datos', 'base datos', 'database'].includes(value)) return 'database';
  if (['ui', 'interfaz', 'interfaz de usuario'].includes(value)) return 'ui';
  if (['recursos', 'resources'].includes(value)) return 'resources';
  return null;
}

function splitSddMarkdownSections(markdown) {
  const sections = { specs: [], database: [], ui: [], resources: [] };
  const present = { specs: false, database: false, ui: false, resources: false };
  let current = 'specs';
  for (const rawLine of stripSddMetadata(markdown).split(/\r?\n/)) {
    const heading = /^#\s+(.+?)\s*#*\s*$/.exec(rawLine);
    if (heading) {
      const section = markdownSectionName(heading[1]);
      current = section;
      if (section) present[section] = true;
      continue;
    }
    if (current) sections[current].push(rawLine);
  }
  return { sections, present };
}

function markdownField(line) {
  const match = /^\s*(?:[-*]\s+)?(?:\*\*)?([^:：]+?)(?:\*\*)?\s*[:：]\s*(.*?)\s*$/.exec(line);
  return match ? { key: normalizeMarkdownLabel(match[1]), value: cleanMarkdownValue(match[2]) } : null;
}

function markdownHeadingText(value, maxLength) {
  return sliceText(cleanMarkdownValue(value).replace(/[\r\n]+/g, ' ').replace(/^#+\s*/, ''), maxLength);
}

function parseSpecsSection(lines) {
  const specs = [];
  let current = null;
  let description = [];
  const heading = /^#{2,4}\s+(.+?)\s*#*\s*$/;
  const identity = /^\s*<!--\s*nexusdata:sdd-spec-id:([A-Za-z0-9_-]+)\s*-->\s*$/i;

  function flush() {
    if (!current) return;
    specs.push({ ...current, description: description.join('\n').trim().replace(/\n{3,}/g, '\n\n') });
    description = [];
  }

  for (const rawLine of lines) {
    const headingMatch = heading.exec(rawLine);
    if (headingMatch) {
      flush();
      const title = markdownHeadingText(headingMatch[1], 200);
      current = title ? { title, description: '', status: 'active', category: '' } : null;
      continue;
    }
    if (!current) continue;
    const identityMatch = identity.exec(rawLine.trim());
    if (identityMatch) {
      current.id = identityMatch[1];
      continue;
    }
    const field = markdownField(rawLine);
    if (field?.key === 'estado') {
      current.status = normalizeSpecStatus(field.value, current.status);
      continue;
    }
    if (field?.key === 'categoria') {
      current.category = sliceText(field.value, 60);
      continue;
    }
    if (field?.key === 'color' || field?.key === 'color de tarjeta') {
      current.color = normalizeSpecCardColor(field.value);
      continue;
    }
    if (field?.key === 'prioridad') continue;
    description.push(rawLine.trimEnd());
  }
  flush();
  return specs;
}

function parseSddSpecsMarkdown(markdown) {
  return parseSpecsSection(splitSddMarkdownSections(markdown).sections.specs);
}

function splitMarkdownTableRow(rawLine) {
  const line = String(rawLine ?? '').trim();
  if (!line.startsWith('|')) return null;
  const source = line.endsWith('|') ? line.slice(1, -1) : line.slice(1);
  const cells = [];
  let cell = '';
  let escaped = false;
  for (const character of source) {
    if (escaped) {
      cell += character;
      escaped = false;
    } else if (character === '\\') {
      escaped = true;
    } else if (character === '|') {
      cells.push(cleanMarkdownValue(cell));
      cell = '';
    } else {
      cell += character;
    }
  }
  cells.push(cleanMarkdownValue(cell));
  return cells;
}

function isMarkdownTableDivider(cells) {
  return Array.isArray(cells) && cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseMarkdownTable(lines) {
  for (let index = 0; index < lines.length - 1; index += 1) {
    const headers = splitMarkdownTableRow(lines[index]);
    const divider = splitMarkdownTableRow(lines[index + 1]);
    if (!headers || !divider || headers.length !== divider.length || !isMarkdownTableDivider(divider)) continue;
    const rows = [];
    let cursor = index + 2;
    while (cursor < lines.length) {
      const row = splitMarkdownTableRow(lines[cursor]);
      if (!row || row.length !== headers.length) break;
      rows.push(row);
      cursor += 1;
    }
    return { headers: headers.map(normalizeMarkdownLabel), rows, start: index, end: cursor };
  }
  return null;
}

function tableColumnIndex(headers, names) {
  return headers.findIndex((header) => names.includes(header));
}

function valueAt(row, index) {
  return index >= 0 ? row[index] || '' : '';
}

function isPrimaryKey(value) {
  return ['pk', 'primary key', 'clave primaria', 'si', 'yes', 'true', '1'].includes(normalizeMarkdownLabel(value));
}

function parseDatabaseSection(lines) {
  const tables = [];
  let current = null;
  let body = [];
  const heading = /^#{2,4}\s+(.+?)\s*#*\s*$/;

  function flush() {
    if (!current) return;
    const table = parseMarkdownTable(body);
    const descriptionLines = table
      ? body.filter((_line, index) => index < table.start || index >= table.end)
      : body;
    const headers = table?.headers || [];
    const nameIndex = tableColumnIndex(headers, ['columna', 'nombre']);
    const typeIndex = tableColumnIndex(headers, ['tipo', 'type']);
    const nullableIndex = tableColumnIndex(headers, ['nulo', 'nullable', 'admite null']);
    const keyIndex = tableColumnIndex(headers, ['clave', 'key']);
    const defaultIndex = tableColumnIndex(headers, ['predeterminado', 'valor por defecto', 'default']);
    const descriptionIndex = tableColumnIndex(headers, ['descripcion', 'description']);
    const columns = (table?.rows || []).map((row, index) => ({
      name: sliceText(valueAt(row, nameIndex >= 0 ? nameIndex : 0).replace(/^—$/, ''), 120),
      type: sliceText(valueAt(row, typeIndex).replace(/^—$/, ''), 60),
      nullable: asBoolean(valueAt(row, nullableIndex), true),
      primaryKey: isPrimaryKey(valueAt(row, keyIndex)),
      defaultValue: sliceText(valueAt(row, defaultIndex).replace(/^—$/, ''), 200),
      description: sliceText(valueAt(row, descriptionIndex).replace(/^—$/, '').replace(/<br\s*\/?\s*>/gi, '\n'), 1000),
      position: index
    })).filter((column) => column.name);
    tables.push({
      name: current.name,
      description: descriptionLines.join('\n').trim().replace(/\n{3,}/g, '\n\n'),
      columns
    });
    body = [];
  }

  for (const rawLine of lines) {
    const headingMatch = heading.exec(rawLine);
    if (headingMatch) {
      flush();
      const name = markdownHeadingText(headingMatch[1], 120);
      current = name ? { name } : null;
      continue;
    }
    if (current) body.push(rawLine.trimEnd());
  }
  flush();
  return normalizeDatabase({ tables });
}

function normaliseMediaKind(value, fallback = 'text') {
  const kind = normalizeMarkdownLabel(value);
  if (['text', 'texto'].includes(kind)) return 'text';
  if (['image', 'imagen'].includes(kind)) return 'image';
  if (kind === 'video') return 'video';
  if (['audio', 'sonido'].includes(kind)) return 'audio';
  return fallback;
}

function resourceFileNameFromMarkdown(value) {
  const link = /\(([^)]+)\)/.exec(String(value ?? ''));
  const raw = cleanMarkdownValue(link ? link[1] : value)
    .replace(/^(?:\.?(?:\\|\/))?specs_resources(?:\\|\/)/i, '')
    .replace(/\\/g, '/');
  if (!raw || path.isAbsolute(raw) || raw.split('/').some((segment) => segment === '..')) return '';
  return raw;
}

function parseUiSection(lines) {
  const media = [];
  let current = null;
  let body = [];
  const heading = /^#{2,4}\s+(.+?)\s*#*\s*$/;

  function flush() {
    if (!current) return;
    let kind = 'text';
    let description = '';
    let fileName = '';
    const content = [];
    for (const rawLine of body) {
      const field = markdownField(rawLine);
      if (field?.key === 'tipo') {
        kind = normaliseMediaKind(field.value, kind);
        continue;
      }
      if (field?.key === 'descripcion') {
        description = sliceText(field.value.replace(/<br\s*\/?\s*>/gi, '\n'), 5000);
        continue;
      }
      if (field?.key === 'archivo') {
        fileName = resourceFileNameFromMarkdown(field.value);
        continue;
      }
      if (/^\s*contenido\s*[:：]\s*$/i.test(rawLine)) continue;
      content.push(rawLine.trimEnd());
    }
    if (kind === 'text' && fileName) {
      const mime = mimeForFileName(fileName);
      kind = normaliseMediaKind(mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : 'image');
    }
    media.push({
      title: current.title,
      description,
      kind,
      content: kind === 'text' ? content.join('\n').trim().replace(/\n{3,}/g, '\n\n') : '',
      fileName: kind === 'text' ? '' : fileName
    });
    body = [];
  }

  for (const rawLine of lines) {
    const headingMatch = heading.exec(rawLine);
    if (headingMatch) {
      flush();
      const title = markdownHeadingText(headingMatch[1], 200);
      current = title ? { title } : null;
      continue;
    }
    if (current) body.push(rawLine.trimEnd());
  }
  flush();
  return normalizeMedia({ media });
}

function parseSddDocument(markdown) {
  const rawMarkdown = String(markdown ?? '');
  const { sections, present } = splitSddMarkdownSections(rawMarkdown);
  const legacyDatabase = normalizeDatabase(extractSddMetadata(rawMarkdown, 'database'));
  const legacyMedia = normalizeMedia(extractSddMetadata(rawMarkdown, 'ui'));
  return {
    markdown: stripSddMetadata(rawMarkdown).trim(),
    specs: parseSpecsSection(sections.specs),
    database: present.database ? parseDatabaseSection(sections.database) : legacyDatabase,
    media: present.ui ? parseUiSection(sections.ui) : legacyMedia,
    sections: present
  };
}

function markdownTableCell(value) {
  const text = String(value ?? '').replace(/\r?\n/g, '<br>').replace(/\|/g, '\\|').trim();
  return text || '—';
}

function isCompletedSpecStatus(status) {
  return normalizeSpecStatus(status) === 'implemented';
}

function pendingSddSpecs(specs) {
  return (Array.isArray(specs) ? specs : []).filter((spec) => !isCompletedSpecStatus(spec?.status));
}

// Plantilla por defecto de una versión recién creada: sin specs.
function emptySddSpecsMarkdown() {
  return '# Specs\n';
}

function sddSpecsToMarkdown(specs) {
  if (!specs.length) return emptySddSpecsMarkdown();
  const blocks = specs.map((spec) => {
    const status = normalizeSpecStatus(spec.status);
    const lines = [`## ${markdownHeadingText(spec.title, 200)}`, `- Estado: ${SPEC_STATUS_LABELS[status]}`];
    if (spec.category) lines.push(`- Categoría: ${sliceText(spec.category, 60)}`);
    const color = normalizeSpecCardColor(spec.color);
    if (color) lines.push(`- Color: ${SPEC_CARD_COLOR_LABELS[color]}`);
    if (spec.description) lines.push('', spec.description.trim());
    return lines.join('\n');
  });
  return `# Specs\n\n${blocks.join('\n\n')}\n`;
}

function normaliseSddVersionName(value) {
  const raw = asText(value).replace(/\.md$/i, '');
  if (!raw) throw new Error('Indica el nombre de la versión');
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/.test(raw) || raw === '.' || raw === '..') {
    throw new Error('El nombre de versión solo puede contener letras, números, puntos, guiones y guiones bajos');
  }
  return raw;
}

function versionSort(left, right) {
  return String(left).localeCompare(String(right), 'es', { numeric: true, sensitivity: 'base' });
}

function listSddVersions(projectPath) {
  const paths = resolveSddPaths(projectPath);
  let entries = [];
  try {
    entries = fs.readdirSync(paths.specsDirectoryPath, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md') && !entry.name.startsWith('.'))
    .map((entry) => {
      const name = entry.name.slice(0, -3);
      try { normaliseSddVersionName(name); } catch { return null; }
      const filePath = path.join(paths.specsDirectoryPath, entry.name);
      const stats = fs.statSync(filePath);
      const specs = specsWithIdentity(parseSddSpecsMarkdown(fs.readFileSync(filePath, 'utf8')), stats.mtime.toISOString());
      return {
        name,
        fileName: entry.name,
        path: filePath,
        modifiedAt: stats.mtime.toISOString(),
        total: specs.length,
        pendingTotal: pendingSddSpecs(specs).length
      };
    })
    .filter(Boolean)
    .sort((left, right) => versionSort(left.name, right.name));
}

function resolveSddVersion(projectPath, requestedVersion = '') {
  const versions = listSddVersions(projectPath);
  if (!versions.length) throw new Error(`El proyecto no contiene versiones en ${SDD_FOLDER_NAME}/${SDD_SPECS_DIRECTORY}`);
  const requested = asText(requestedVersion);
  if (!requested) return { version: versions.at(-1), versions };
  const name = normaliseSddVersionName(requested);
  const version = versions.find((item) => item.name === name);
  if (!version) throw new Error(`La versión “${name}” no existe`);
  return { version, versions };
}

function fullSpecsMarkdown(projectPath) {
  const snapshots = listSddVersions(projectPath);
  if (!snapshots.length) return '# Specs completas\n';
  const sections = snapshots.map((snapshot) => {
    const markdown = fs.readFileSync(snapshot.path, 'utf8');
    const body = sddSpecsToMarkdown(parseSddSpecsMarkdown(markdown))
      .replace(/^#\s+Specs\s*/i, '')
      .trim();
    return `## Versión ${snapshot.name}\n\n${body || 'Sin especificaciones.'}`;
  });
  return `# Specs completas\n\n${sections.join('\n\n')}\n`;
}

function syncFullSpecsMarkdown(projectPath) {
  const paths = resolveSddPaths(projectPath);
  const next = fullSpecsMarkdown(projectPath);
  let current = '';
  try { current = fs.readFileSync(paths.fullPath, 'utf8'); } catch { /* se crea debajo */ }
  if (current !== next) fs.writeFileSync(paths.fullPath, next, { encoding: 'utf8', mode: 0o600 });
  return next;
}

function sddDatabaseToMarkdown(database) {
  const tables = normalizeDatabase(database).tables;
  if (!tables.length) return '# BBDD\n\nNo hay tablas definidas.\n';
  const blocks = tables.map((table) => {
    const columns = [...table.columns].sort((a, b) => Number(a.position) - Number(b.position));
    const lines = [`## ${markdownHeadingText(table.name, 120)}`];
    if (table.description) lines.push('', table.description.trim());
    if (columns.length) {
      lines.push('', '| Columna | Tipo | Nulo | Clave | Predeterminado | Descripción |');
      lines.push('| --- | --- | --- | --- | --- | --- |');
      columns.forEach((column) => lines.push(`| \`${markdownTableCell(column.name)}\` | \`${markdownTableCell(column.type)}\` | ${column.nullable ? 'Sí' : 'No'} | ${column.primaryKey ? 'PK' : '—'} | ${markdownTableCell(column.defaultValue)} | ${markdownTableCell(column.description)} |`));
    }
    return lines.join('\n');
  });
  return `# BBDD\n\n${blocks.join('\n\n')}\n`;
}

function mediaKindLabel(kind) {
  return { text: 'Texto', image: 'Imagen', video: 'Vídeo', audio: 'Audio' }[kind] || 'Texto';
}

function sddUiToMarkdown(media) {
  const items = normalizeMedia(media).media;
  if (!items.length) return '# UI\n\nNo hay referencias de interfaz definidas.\n';
  const blocks = items.map((item) => {
    const lines = [`## ${markdownHeadingText(item.title, 200)}`, `- Tipo: ${mediaKindLabel(item.kind)}`];
    if (item.fileName) lines.push(`- Archivo: \`specs_resources/${item.fileName.replace(/\\/g, '/')}\``);
    if (item.description) lines.push(`- Descripción: ${item.description.replace(/\r?\n/g, '<br>')}`);
    if (item.kind === 'text' && item.content) lines.push('', item.content.trim());
    return lines.join('\n');
  });
  return `# UI\n\n${blocks.join('\n\n')}\n`;
}

function listSddResourceFiles(projectPath) {
  return listSddResourceEntries(projectPath).files.map((entry) => entry.relativePath);
}

function listSddResourceEntries(projectPath) {
  const root = resolveSddPaths(projectPath).resourcesPath;
  const files = [];
  const directories = [];
  function visit(directory, relativePath = '') {
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name, 'es'));
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const relative = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        directories.push({ relativePath: relative, fullPath });
        visit(fullPath, relative);
      } else if (entry.isFile()) {
        files.push({ relativePath: relative, fullPath });
      }
    }
  }
  try { visit(root); } catch { return { files: [], directories: [] }; }
  return { files, directories };
}

function normaliseResourceName(value, { allowEmpty = false } = {}) {
  const raw = String(value ?? '').trim().replace(/\\/g, '/');
  if (!raw) {
    if (allowEmpty) return '';
    throw new Error('Indica el nombre del recurso');
  }
  if (path.posix.isAbsolute(raw) || path.win32.isAbsolute(raw)) throw new Error('El recurso debe estar dentro de specs_resources');
  const segments = raw.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) throw new Error('La ruta del recurso no es válida');
  return segments.join('/');
}

function normaliseResourceFileName(value) {
  const name = normaliseResourceName(value);
  return name.split('/').map((segment) => {
    const clean = segment
      .replace(/[<>:"|?*\u0000-\u001f]/g, '-')
      .replace(/\s+/g, ' ')
      .replace(/^-+|-+$/g, '');
    return clean || 'recurso';
  }).join('/');
}

function resourceReferenceKey(value) {
  return normaliseResourceName(value).toLowerCase();
}

function collectSddResourceReferences(projectPath) {
  const references = new Map();
  const add = (fileName, reference) => {
    let normalised;
    try { normalised = normaliseResourceName(fileName); } catch { return; }
    const key = normalised.toLowerCase();
    const current = references.get(key) || [];
    if (!current.some((item) => item.label === reference.label)) current.push(reference);
    references.set(key, current);
  };

  const resourcePattern = /specs_resources[\\/]([^\s)\]<>"'`]+)/gi;
  const paths = resolveSddPaths(projectPath);
  const markdownSources = [
    ...listSddVersions(projectPath).map((version) => ({ label: `versión ${version.name}`, path: version.path })),
    { label: 'BBDD', path: paths.databasePath }
  ];
  for (const source of markdownSources) {
    if (!isFile(source.path)) continue;
    const lines = fs.readFileSync(source.path, 'utf8').split(/\r?\n/);
    lines.forEach((line, index) => {
      let match;
      resourcePattern.lastIndex = 0;
      while ((match = resourcePattern.exec(line))) {
        const rawName = match[1].replace(/[.,;:]+$/g, '');
        add(rawName, { label: `Markdown · ${source.label} · línea ${index + 1}`, kind: 'markdown' });
      }
    });
  }
  return references;
}

function resourceByteLimit(kind) {
  if (kind === 'image') return IMAGE_MAX_BYTES;
  if (kind === 'video') return VIDEO_MAX_BYTES;
  if (kind === 'audio') return AUDIO_MAX_BYTES;
  return RESOURCE_MAX_BYTES;
}

async function detectResourceType(filePath, { fileName = filePath, probeUnknown = false } = {}) {
  const detected = detectFileType(filePath, { fileName });
  if (!probeUnknown || detected.kind !== 'file') return detected;
  let stats;
  try { stats = fs.statSync(filePath); } catch { return detected; }
  const cacheKey = `${filePath}:${stats.size}:${stats.mtimeMs}`;
  if (resourceProbeCache.has(cacheKey)) return resourceProbeCache.get(cacheKey);
  const pending = probeFile(filePath, { fileName })
    .then((probed) => probed || detected)
    .catch(() => detected);
  if (resourceProbeCache.size >= RESOURCE_PROBE_CACHE_LIMIT) {
    const oldestKey = resourceProbeCache.keys().next().value;
    if (oldestKey) resourceProbeCache.delete(oldestKey);
  }
  resourceProbeCache.set(cacheKey, pending);
  return pending;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  };
  const workers = Array.from({ length: Math.min(Math.max(Number(concurrency) || 1, 1), items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

function resourceResponse(projectPath, entry, references, detected = null) {
  const stats = fs.statSync(entry.fullPath);
  const type = detected || detectFileType(entry.fullPath, { fileName: entry.relativePath });
  const referenceList = references.get(resourceReferenceKey(entry.relativePath)) || [];
  const directory = path.posix.dirname(entry.relativePath);
  return {
    name: path.posix.basename(entry.relativePath),
    relativePath: entry.relativePath.replace(/\\/g, '/'),
    directory: directory === '.' ? '' : directory,
    path: entry.fullPath,
    kind: type.kind,
    type: type.mime,
    detectedBy: type.detectedBy,
    size: stats.size,
    modifiedAt: stats.mtime.toISOString(),
    fileUrl: resourceUrl(projectPath, entry.relativePath),
    transcodeUrl: type.kind === 'audio' ? resourceUrl(projectPath, entry.relativePath, 'resources/transcode') : null,
    referenced: referenceList.length > 0,
    references: referenceList
  };
}

function resourceFolderResponse(projectPath, entry) {
  const directory = path.posix.dirname(entry.relativePath);
  return {
    name: path.posix.basename(entry.relativePath),
    relativePath: entry.relativePath.replace(/\\/g, '/'),
    directory: directory === '.' ? '' : directory,
    path: entry.fullPath,
    kind: 'folder'
  };
}

async function listSddResources(projectPath, filters = {}) {
  assertVersionedSddProject(projectPath);
  const { files, directories } = listSddResourceEntries(projectPath);
  const references = collectSddResourceReferences(projectPath);
  const query = String(filters.q || '').trim().toLocaleLowerCase();
  const kind = String(filters.kind || '').trim().toLowerCase();
  const folder = normaliseResourceName(filters.folder || '', { allowEmpty: true });
  const inFolder = (relativePath) => !folder || relativePath === folder || relativePath.startsWith(`${folder}/`);
  const matches = (relativePath, type = '') => inFolder(relativePath)
    && (!query || relativePath.toLocaleLowerCase().includes(query))
    && (!kind || kind === 'all' || type === kind);
  const detections = await mapWithConcurrency(files, 4, (entry) => detectResourceType(entry.fullPath, {
    fileName: entry.relativePath,
    probeUnknown: true
  }));
  const resources = files
    .map((entry, index) => ({ entry, detected: detections[index] }))
    .filter(({ entry, detected }) => matches(entry.relativePath, detected.kind))
    .map(({ entry, detected }) => resourceResponse(projectPath, entry, references, detected));
  const folders = directories
    .filter((entry) => matches(entry.relativePath, 'folder'))
    .map((entry) => resourceFolderResponse(projectPath, entry));
  return {
    folder: resolveSddPaths(projectPath).resourcesPath,
    total: files.length,
    referenced: resources.filter((resource) => resource.referenced).length,
    resources,
    folders
  };
}

const REPORT_STOP_WORDS = new Set(['para', 'por', 'con', 'sin', 'desde', 'hacia', 'sobre', 'entre', 'como', 'cuando', 'donde', 'esta', 'este', 'estas', 'estos', 'debe', 'deben', 'puede', 'pueden', 'permite', 'permitir', 'que', 'los', 'las', 'una', 'uno', 'unos', 'unas', 'del', 'las', 'sus', 'ser', 'sea', 'son', 'hay', 'cada']);

function reportTokens(value) {
  return new Set(normalizeMarkdownLabel(value)
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 3 && !REPORT_STOP_WORDS.has(token)));
}

function reportTokensRelated(left, right) {
  if (!left || !right) return false;
  return left === right
    || (left.length >= 4 && right.length >= 4 && (left.startsWith(right) || right.startsWith(left)));
}

function reportTextRelated(leftText, rightText) {
  const left = reportTokens(leftText);
  const right = reportTokens(rightText);
  return [...left].some((leftToken) => [...right].some((rightToken) => reportTokensRelated(leftToken, rightToken)));
}

function reportTableText(table) {
  return [table.name, table.description, ...(table.columns || []).flatMap((column) => [column.name, column.type, column.description])].join(' ');
}

function sddReport(projectPath, document, database, resourceListing) {
  const tables = database?.tables || [];
  const resources = resourceListing.resources || [];
  const statusCoverage = { active: 50, implemented: 100 };
  const coverageMatrix = document.specs.map((spec) => {
    const specText = [spec.title, spec.category, spec.description].join(' ');
    const relatedDatabase = tables.filter((table) => reportTextRelated(specText, reportTableText(table)));
    const relatedResources = resources.filter((resource) => reportTextRelated(specText, [resource.name, resource.relativePath].join(' ')));
    return {
      id: spec.id,
      title: spec.title,
      category: spec.category,
      status: spec.status,
      hasDescription: Boolean(String(spec.description || '').trim()),
      databaseCount: relatedDatabase.length,
      resourceCount: relatedResources.length,
      coverage: statusCoverage[spec.status] ?? 0
    };
  });
  const implemented = coverageMatrix.filter((row) => row.status === 'implemented').length;
  const described = coverageMatrix.filter((row) => row.hasDescription).length;
  return {
    version: 1,
    project: { name: path.basename(projectPath) || projectPath, path: projectPath },
    generatedAt: new Date().toISOString(),
    summary: {
      specs: document.specs.length,
      describedSpecs: described,
      implementedSpecs: implemented,
      coveragePercent: document.specs.length ? Math.round(coverageMatrix.reduce((total, row) => total + row.coverage, 0) / document.specs.length) : 0,
      tables: tables.length,
      columns: tables.reduce((total, table) => total + table.columns.length, 0),
      resources: resources.length,
      referencedResources: resources.filter((resource) => resource.referenced).length
    },
    coverageMatrix,
    specs: document.specs,
    database: tables.map(tableForResponse),
    resources: resources.map(({ path: _path, ...resource }) => resource)
  };
}

function sddResourcesToMarkdown(projectPath) {
  const resources = listSddResourceFiles(projectPath);
  if (!resources.length) return '# Recursos\n\nLa carpeta `specs_resources` no contiene archivos.\n';
  const lines = resources.map((fileName) => {
    const detected = detectFileType(path.join(resolveSddPaths(projectPath).resourcesPath, fileName), { fileName });
    const kind = detected.kind === 'image' ? 'Imagen' : detected.kind === 'video' ? 'Vídeo' : detected.kind === 'audio' ? 'Audio' : 'Archivo';
    return `- \`specs_resources/${fileName}\` — ${kind}`;
  });
  return `# Recursos\n\n${lines.join('\n')}\n`;
}

function sddDocumentToMarkdown(_projectPath, specs) {
  // Los snapshots de versión solo contienen Specs. BBDD se persiste en
  // `bbdd.md` y los recursos siguen viviendo como archivos reales.
  return sddSpecsToMarkdown(specs);
}

function tableInput(body, existing = null) {
  const name = asText(body?.name, existing?.name || '').slice(0, 120);
  if (!name) throw new Error('Indica un nombre para la tabla');
  return { name, description: sliceText(body?.description, 2000) };
}

function columnInput(body, existing = null) {
  const name = asText(body?.name, existing?.name || '').slice(0, 120);
  if (!name) throw new Error('Indica un nombre para la columna');
  return {
    name,
    type: asText(body?.type, existing?.type || '').slice(0, 60),
    nullable: asBoolean(body?.nullable, existing ? Boolean(existing.nullable) : true),
    primaryKey: asBoolean(body?.primaryKey, existing ? Boolean(existing.primaryKey) : false),
    defaultValue: sliceText(body?.defaultValue, 200),
    description: sliceText(body?.description, 1000)
  };
}

function mediaInput(body, existing = null) {
  const title = asText(body?.title, existing?.title || '').slice(0, 200);
  if (!title) throw new Error('Indica un título para el contenido');
  return {
    title,
    description: sliceText(body?.description, 5000),
    content: existing?.kind === 'text' ? sliceText(body?.content, TEXT_MAX_LENGTH) : (existing?.content || '')
  };
}

function mimeForFileName(fileName) {
  const extension = path.extname(String(fileName || '')).toLowerCase().replace('.', '');
  return MEDIA_MIME_BY_EXTENSION[extension] || '';
}

function resolveSddPaths(projectPath) {
  const selectedPath = String(projectPath || '');
  // Permite seleccionar el proyecto o directamente su carpeta SDD_specs,
  // pero devuelve siempre la raíz del proyecto como identidad canónica.
  const selectedIsSddDirectory = path.basename(selectedPath) === SDD_FOLDER_NAME;
  const resolved = selectedIsSddDirectory ? path.dirname(selectedPath) : selectedPath;
  const sddDir = selectedIsSddDirectory ? selectedPath : path.join(resolved, SDD_FOLDER_NAME);
  return {
    projectPath: resolved,
    sddDir,
    legacySpecsPath: path.join(sddDir, SDD_LEGACY_SPECS_FILENAME),
    specsDirectoryPath: path.join(sddDir, SDD_SPECS_DIRECTORY),
    fullPath: path.join(sddDir, SDD_FULL_FILENAME),
    databasePath: path.join(sddDir, SDD_DATABASE_FILENAME),
    resourcesPath: path.join(sddDir, SDD_RESOURCES_DIRECTORY)
  };
}

function isFile(filePath) {
  try { return fs.statSync(filePath).isFile(); } catch { return false; }
}

function isDirectory(directoryPath) {
  try { return fs.statSync(directoryPath).isDirectory(); } catch { return false; }
}

function inspectSddLayout(projectPath) {
  const paths = resolveSddPaths(projectPath);
  const hasLegacySpecs = isFile(paths.legacySpecsPath);
  const hasVersionDirectory = isDirectory(paths.specsDirectoryPath);
  if (hasLegacySpecs && !hasVersionDirectory) return { kind: 'legacy', paths };
  if (!hasVersionDirectory) {
    throw new Error(`El proyecto no contiene la carpeta ${SDD_FOLDER_NAME}/${SDD_SPECS_DIRECTORY}`);
  }
  if (!isDirectory(paths.resourcesPath)) {
    throw new Error(`El proyecto no contiene la carpeta ${SDD_FOLDER_NAME}/${SDD_RESOURCES_DIRECTORY}`);
  }
  if (!isFile(paths.databasePath)) {
    throw new Error(`El proyecto no contiene un archivo ${SDD_FOLDER_NAME}/${SDD_DATABASE_FILENAME}`);
  }
  if (!listSddVersions(projectPath).length) {
    throw new Error(`El proyecto no contiene archivos de versión en ${SDD_FOLDER_NAME}/${SDD_SPECS_DIRECTORY}`);
  }
  return { kind: 'versioned', paths };
}

function validateSddProjectPath(value) {
  const rawPath = asText(value);
  if (!rawPath) throw new Error('Indica la carpeta del proyecto S.D.D');
  let projectPath;
  try {
    projectPath = fs.realpathSync(path.resolve(rawPath));
  } catch {
    throw new Error('La carpeta del proyecto S.D.D no existe');
  }
  if (!fs.statSync(projectPath).isDirectory()) throw new Error('El proyecto S.D.D debe ser una carpeta');
  inspectSddLayout(projectPath);
  return resolveSddPaths(projectPath).projectPath;
}

function projectResponse(projectPath, name = '', requestedVersion = '') {
  const layout = inspectSddLayout(projectPath);
  const { paths } = layout;
  const resolvedVersion = layout.kind === 'versioned'
    ? resolveSddVersion(projectPath, requestedVersion).version
    : null;
  return {
    loaded: true,
    project: {
      name: name || path.basename(projectPath) || projectPath,
      path: projectPath,
      sddDir: paths.sddDir,
      legacy: layout.kind === 'legacy',
      migrationAvailable: layout.kind === 'legacy',
      specsDirectoryPath: paths.specsDirectoryPath,
      specsPath: resolvedVersion?.path || paths.legacySpecsPath,
      fullPath: paths.fullPath,
      databasePath: paths.databasePath,
      resourcesPath: paths.resourcesPath,
      activeVersion: resolvedVersion?.name || null,
      versions: layout.kind === 'versioned' ? listSddVersions(projectPath) : []
    }
  };
}

function assertVersionedSddProject(projectPath) {
  const layout = inspectSddLayout(projectPath);
  if (layout.kind === 'legacy') {
    throw new Error('Este proyecto usa el formato antiguo. Usa “Migrar especificaciones” antes de editarlo.');
  }
  return layout.paths;
}

function readLegacySddProjectDocument(projectPath) {
  const paths = resolveSddPaths(projectPath);
  const sourcePath = isFile(paths.fullPath) ? paths.fullPath : paths.legacySpecsPath;
  const rawMarkdown = fs.readFileSync(sourcePath, 'utf8');
  const parsed = parseSddDocument(rawMarkdown);
  const timestamp = fs.statSync(sourcePath).mtime.toISOString();
  const specs = specsWithIdentity(parsed.specs, timestamp);
  return {
    rawMarkdown,
    markdown: sddSpecsToMarkdown(specs),
    specs,
    pendingTotal: pendingSddSpecs(specs).length,
    timestamp,
    paths,
    legacy: true
  };
}

function readSddProjectDocument(projectPath, requestedVersion = '') {
  const paths = assertVersionedSddProject(projectPath);
  const { version, versions } = resolveSddVersion(projectPath, requestedVersion);
  // specs_full.md es el índice agregado de todos los snapshots. Se refresca al
  // leer para incorporar cambios realizados externamente en una versión.
  syncFullSpecsMarkdown(projectPath);
  const sourcePath = version.path;
  const rawMarkdown = fs.readFileSync(sourcePath, 'utf8');
  if (!rawMarkdown.trim()) throw new Error(`${path.basename(sourcePath)} está vacío`);
  const parsedSpecs = parseSddSpecsMarkdown(rawMarkdown);
  const timestamp = fs.statSync(sourcePath).mtime.toISOString();
  const specs = specsWithIdentity(parsedSpecs, timestamp);
  return {
    rawMarkdown,
    markdown: sddSpecsToMarkdown(specs),
    specs,
    pendingTotal: pendingSddSpecs(specs).length,
    timestamp,
    paths,
    version: version.name,
    versions
  };
}

function readSddDatabaseDocument(projectPath) {
  const paths = assertVersionedSddProject(projectPath);
  const rawMarkdown = fs.readFileSync(paths.databasePath, 'utf8');
  const parsed = parseSddDocument(rawMarkdown);
  return { paths, markdown: sddDatabaseToMarkdown(parsed.database), database: parsed.database };
}

function writeSddProjectDocument(projectPath, requestedVersion, markdown) {
  const paths = assertVersionedSddProject(projectPath);
  const { version } = resolveSddVersion(projectPath, requestedVersion);
  const specs = parseSddSpecsMarkdown(markdown);
  const output = sddSpecsToMarkdown(specs);
  fs.writeFileSync(version.path, output, { encoding: 'utf8', mode: 0o600 });
  syncFullSpecsMarkdown(projectPath);
  return output;
}

function writeSddDatabaseDocument(projectPath, database) {
  const paths = assertVersionedSddProject(projectPath);
  const output = sddDatabaseToMarkdown(database);
  fs.writeFileSync(paths.databasePath, output, { encoding: 'utf8', mode: 0o600 });
  return output;
}

function requestSddProjectPath(req, { required = true } = {}) {
  const candidate = req.get('x-sdd-project-path') || req.query?.projectPath || '';
  if (!candidate && !required) return '';
  return validateSddProjectPath(candidate);
}

function requestSddVersion(req) {
  return req.get('x-sdd-spec-version') || req.query?.version || req.body?.version || '';
}

function migrateLegacySddProject(projectPath) {
  const layout = inspectSddLayout(projectPath);
  if (layout.kind !== 'legacy') throw new Error('El proyecto ya usa especificaciones versionadas');
  const { paths } = layout;
  const fullMarkdown = isFile(paths.fullPath) ? fs.readFileSync(paths.fullPath, 'utf8') : '';
  const legacyMarkdown = fs.readFileSync(paths.legacySpecsPath, 'utf8');
  const fullDocument = fullMarkdown ? parseSddDocument(fullMarkdown) : null;
  const legacyDocument = parseSddDocument(legacyMarkdown);
  const sourceSpecs = fullDocument?.specs?.length ? fullDocument.specs : legacyDocument.specs;
  const sourceDatabase = fullDocument?.database?.tables?.length
    ? fullDocument.database
    : legacyDocument.database;

  fs.mkdirSync(paths.specsDirectoryPath, { recursive: true, mode: 0o700 });
  fs.mkdirSync(paths.resourcesPath, { recursive: true, mode: 0o700 });
  const initialVersionPath = path.join(paths.specsDirectoryPath, '0.0.0.md');
  if (fs.existsSync(initialVersionPath)) throw new Error('Ya existe la versión inicial 0.0.0');
  fs.writeFileSync(initialVersionPath, sddSpecsToMarkdown(sourceSpecs), { encoding: 'utf8', mode: 0o600 });
  fs.writeFileSync(paths.databasePath, sddDatabaseToMarkdown(sourceDatabase), { encoding: 'utf8', mode: 0o600 });
  syncFullSpecsMarkdown(projectPath);
  // La migración solo borra el archivo heredado cuando los tres destinos nuevos
  // ya se han escrito correctamente. Los recursos físicos se conservan.
  fs.rmSync(paths.legacySpecsPath, { force: true });
  return { version: '0.0.0', paths };
}

function safeResourcePath(projectPath, fileName) {
  const rawName = normaliseResourceName(fileName, { allowEmpty: true });
  const { sddDir } = resolveSddPaths(projectPath);
  const resourceRoot = fs.realpathSync(path.join(sddDir, SDD_RESOURCES_DIRECTORY));
  const candidate = path.resolve(resourceRoot, rawName);
  if (candidate !== resourceRoot && !candidate.startsWith(`${resourceRoot}${path.sep}`)) {
    throw new Error(`El recurso está fuera de ${SDD_FOLDER_NAME}/${SDD_RESOURCES_DIRECTORY}`);
  }
  let existingCandidate = candidate;
  while (!fs.existsSync(existingCandidate) && existingCandidate !== path.dirname(existingCandidate)) existingCandidate = path.dirname(existingCandidate);
  const realCandidate = fs.realpathSync(existingCandidate);
  if (realCandidate !== resourceRoot && !realCandidate.startsWith(`${resourceRoot}${path.sep}`)) {
    throw new Error(`El recurso está fuera de ${SDD_FOLDER_NAME}/${SDD_RESOURCES_DIRECTORY}`);
  }
  return candidate;
}

function uniqueResourceFileName(projectPath, originalName) {
  const cleanName = normaliseResourceFileName(originalName || 'recurso');
  const extension = path.posix.extname(cleanName).toLowerCase();
  const directory = path.posix.dirname(cleanName);
  const stem = path.posix.basename(cleanName, extension) || 'recurso';
  let fileName = directory === '.' ? `${stem}${extension}` : `${directory}/${stem}${extension}`;
  let index = 1;
  while (fs.existsSync(safeResourcePath(projectPath, fileName))) {
    fileName = directory === '.' ? `${stem}-${index}${extension}` : `${directory}/${stem}-${index}${extension}`;
    index += 1;
  }
  return fileName;
}

function resourceDestinationPath(projectPath, fileName) {
  const normalised = normaliseResourceFileName(fileName);
  const destination = safeResourcePath(projectPath, normalised);
  const { resourcesPath } = resolveSddPaths(projectPath);
  const root = fs.realpathSync(resourcesPath);
  let existingParent = path.dirname(destination);
  while (!fs.existsSync(existingParent) && existingParent !== path.dirname(existingParent)) existingParent = path.dirname(existingParent);
  const realParent = fs.realpathSync(existingParent);
  if (realParent !== root && !realParent.startsWith(`${root}${path.sep}`)) {
    throw new Error(`El destino está fuera de ${SDD_FOLDER_NAME}/${SDD_RESOURCES_DIRECTORY}`);
  }
  return { fileName: normalised, destination };
}

function replaceResourceReferences(markdown, oldName, newName, { directory = false } = {}) {
  const oldPath = normaliseResourceName(oldName);
  const nextPath = normaliseResourceName(newName);
  const escapedOld = oldPath.split('/').map((segment) => escapeRegExp(segment)).join('[\\\\/]');
  const boundary = directory
    ? `(?=[\\\\/]|$|[\\s)\\]<>"'\\x60])`
    : `(?=$|[\\s)\\]<>"'\\x60?#])`;
  const expression = new RegExp(`specs_resources[\\\\/]${escapedOld}${boundary}`, 'gi');
  return String(markdown ?? '').replace(expression, `specs_resources/${nextPath}`);
}

function referencedResourceFiles(projectPath, resourceName) {
  const references = collectSddResourceReferences(projectPath);
  const normalised = normaliseResourceName(resourceName);
  const key = normalised.toLowerCase();
  return references.get(key) || [];
}

function resourceNamesInside(projectPath, relativePath, isDirectory) {
  if (!isDirectory) return [normaliseResourceName(relativePath)];
  const prefix = `${normaliseResourceName(relativePath)}/`;
  return listSddResourceEntries(projectPath).files
    .map((entry) => entry.relativePath)
    .filter((name) => name.toLowerCase().startsWith(prefix.toLowerCase()));
}

function streamRequestToFile(req, filePath, maxBytes) {
  const declaredLength = Number(req.headers['content-length']);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    const error = new Error('El archivo supera el límite de tamaño permitido');
    error.code = 'PAYLOAD_TOO_LARGE';
    return Promise.reject(error);
  }
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(filePath, { flags: 'wx', mode: 0o600 });
    let size = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      output.destroy();
      try { fs.rmSync(filePath, { force: true }); } catch { /* no hay nada más que limpiar */ }
      reject(error);
    };
    output.on('error', fail);
    output.on('drain', () => req.resume());
    req.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > maxBytes) {
        const error = new Error('El archivo supera el límite de tamaño permitido');
        error.code = 'PAYLOAD_TOO_LARGE';
        fail(error);
        req.resume();
        return;
      }
      if (!output.write(chunk)) req.pause();
    });
    req.on('error', fail);
    req.on('end', () => {
      if (settled) return;
      output.end(() => {
        settled = true;
        resolve(size);
      });
    });
  });
}

function streamFileWithRanges(req, res, filePath, mime, { download = false } = {}) {
  const stats = fs.statSync(filePath);
  res.set('Content-Type', mime || 'application/octet-stream');
  res.set('Accept-Ranges', 'bytes');
  res.set('Cache-Control', 'no-store');
  if (download) {
    const safeName = path.basename(filePath).replace(/["\r\n]/g, '_');
    res.set('Content-Disposition', `attachment; filename="${safeName}"`);
  } else {
    res.set('Content-Disposition', 'inline');
  }
  if (req.method === 'HEAD') return res.status(200).set('Content-Length', String(stats.size)).end();
  const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || '').trim());
  try {
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : 0;
      let end = range[2] ? Number(range[2]) : stats.size - 1;
      if (!range[1]) { start = Math.max(stats.size - Number(range[2]), 0); end = stats.size - 1; }
      end = Math.min(end, stats.size - 1);
      if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= stats.size) {
        return res.status(416).set('Content-Range', `bytes */${stats.size}`).end();
      }
      res.status(206);
      res.set('Content-Range', `bytes ${start}-${end}/${stats.size}`);
      res.set('Content-Length', String(end - start + 1));
      return fs.createReadStream(filePath, { start, end }).pipe(res);
    }
    res.set('Content-Length', String(stats.size));
    return fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    if (!res.headersSent) return res.status(500).json({ error: 'No se pudo leer el recurso' });
    res.destroy(error);
  }
}

function installSddRoutes(app) {
  app.use('/api/sdd', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/sdd/project', (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req, { required: false });
      if (!projectPath) return res.json({ loaded: false, project: null });
      const requestedVersion = requestSddVersion(req);
      const response = projectResponse(projectPath, '', requestedVersion);
      const document = response.project.legacy
        ? readLegacySddProjectDocument(projectPath)
        : readSddProjectDocument(projectPath, requestedVersion);
      return res.json({ ...response, markdown: document.markdown, total: document.specs.length, pendingTotal: document.pendingTotal, specs: document.specs, version: document.version || null });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.post(['/api/sdd/project', '/api/sdd/project/load'], (req, res) => {
    try {
      const projectPath = validateSddProjectPath(req.body?.path || req.body?.projectPath);
      const name = (asText(req.body?.name) || path.basename(projectPath) || 'Proyecto S.D.D').slice(0, 120);
      const requestedVersion = asText(req.body?.activeVersion) || requestSddVersion(req);
      const response = projectResponse(projectPath, name, requestedVersion);
      const document = response.project.legacy
        ? readLegacySddProjectDocument(projectPath)
        : readSddProjectDocument(projectPath, requestedVersion);
      return res.json({ ...response, markdown: document.markdown, total: document.specs.length, pendingTotal: document.pendingTotal, specs: document.specs, version: document.version || null });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  // El servidor no conserva un proyecto activo: descargar el contexto solo es una operación del renderer.
  app.delete('/api/sdd/project', (_req, res) => res.status(204).end());

  app.get('/api/sdd/versions', (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      assertVersionedSddProject(projectPath);
      const { version, versions } = resolveSddVersion(projectPath, requestSddVersion(req));
      return res.json({ activeVersion: version.name, versions });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/sdd/versions', (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      const paths = assertVersionedSddProject(projectPath);
      const name = normaliseSddVersionName(req.body?.version || req.body?.name);
      const versions = listSddVersions(projectPath);
      if (versions.some((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
        return res.status(409).json({ error: `La versión “${name}” ya existe` });
      }
      // La versión nueva nace vacía con la plantilla por defecto: las specs de
      // la versión activa no se copian. `sourceVersion` se acepta por
      // compatibilidad con clientes antiguos, pero ya no se usa.
      const destination = path.join(paths.specsDirectoryPath, `${name}.md`);
      fs.writeFileSync(destination, emptySddSpecsMarkdown(), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      syncFullSpecsMarkdown(projectPath);
      const version = resolveSddVersion(projectPath, name).version;
      return res.status(201).json({ version, activeVersion: name, versions: listSddVersions(projectPath) });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/sdd/migrate', (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      const migrated = migrateLegacySddProject(projectPath);
      const document = readSddProjectDocument(projectPath, migrated.version);
      return res.json({
        migrated: true,
        ...projectResponse(projectPath, '', migrated.version),
        markdown: document.markdown,
        total: document.specs.length,
        pendingTotal: document.pendingTotal,
        specs: document.specs,
        version: migrated.version
      });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.get('/api/sdd/specs', (req, res) => {
    try {
      const document = readSddProjectDocument(requestSddProjectPath(req), requestSddVersion(req));
      return res.json({ version: document.version, specs: document.specs, total: document.specs.length, pendingTotal: document.pendingTotal });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/sdd/specs', (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      const document = readSddProjectDocument(projectPath, requestSddVersion(req));
      const input = specInput(req.body);
      const specs = [...document.specs, { ...input, createdAt: document.timestamp, updatedAt: document.timestamp }];
      writeSddProjectDocument(projectPath, document.version, sddSpecsToMarkdown(specs));
      const updated = readSddProjectDocument(projectPath, document.version);
      return res.status(201).json(updated.specs[updated.specs.length - 1]);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/sdd/specs/:id/duplicate', (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      const document = readSddProjectDocument(projectPath, requestSddVersion(req));
      const source = document.specs.find((spec) => spec.id === req.params.id);
      if (!source) return res.status(404).json({ error: 'Especificación no encontrada' });
      const title = asText(req.body?.title) || `Copia de ${source.title}`;
      const timestamp = new Date().toISOString();
      const duplicate = {
        ...specInput({ title, status: source.status, category: source.category, description: source.description, color: source.color }),
        createdAt: timestamp,
        updatedAt: timestamp
      };
      writeSddProjectDocument(projectPath, document.version, sddSpecsToMarkdown([...document.specs, duplicate]));
      const updated = readSddProjectDocument(projectPath, document.version);
      return res.status(201).json(updated.specs[updated.specs.length - 1]);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.patch('/api/sdd/specs/bulk', (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      const document = readSddProjectDocument(projectPath, requestSddVersion(req));
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((id) => asText(id)).filter(Boolean) : [];
      if (!ids.length || new Set(ids).size !== ids.length) throw new Error('Selecciona requisitos distintos para editar');
      const changes = specChanges(req.body?.changes && typeof req.body.changes === 'object' ? req.body.changes : {});
      const selected = new Set(ids);
      if (ids.some((id) => !document.specs.some((spec) => spec.id === id))) throw new Error('Uno de los requisitos seleccionados ya no existe');
      const timestamp = new Date().toISOString();
      const specs = document.specs.map((spec) => selected.has(spec.id) ? { ...spec, ...changes, updatedAt: timestamp } : spec);
      writeSddProjectDocument(projectPath, document.version, sddSpecsToMarkdown(specs));
      const updated = readSddProjectDocument(projectPath, document.version);
      return res.json({ updated: updated.specs.filter((spec) => selected.has(spec.id)), specs: updated.specs });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/sdd/specs/reorder', (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      const document = readSddProjectDocument(projectPath, requestSddVersion(req));
      const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((id) => asText(id)).filter(Boolean) : [];
      const currentIds = document.specs.map((spec) => spec.id);
      if (ids.length !== currentIds.length || new Set(ids).size !== ids.length || ids.some((id) => !currentIds.includes(id))) {
        throw new Error('El orden de los requisitos no es válido');
      }
      const byId = new Map(document.specs.map((spec) => [spec.id, spec]));
      writeSddProjectDocument(projectPath, document.version, sddSpecsToMarkdown(ids.map((id) => byId.get(id))));
      const updated = readSddProjectDocument(projectPath, document.version);
      return res.json({ specs: updated.specs });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.put('/api/sdd/specs/:id', (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      const document = readSddProjectDocument(projectPath, requestSddVersion(req));
      const index = document.specs.findIndex((spec) => spec.id === req.params.id);
      if (index < 0) return res.status(404).json({ error: 'Especificación no encontrada' });
      const input = specInput(req.body, document.specs[index]);
      const specs = document.specs.map((spec, itemIndex) => itemIndex === index ? { ...spec, ...input, updatedAt: document.timestamp } : spec);
      writeSddProjectDocument(projectPath, document.version, sddSpecsToMarkdown(specs));
      const updated = readSddProjectDocument(projectPath, document.version);
      return res.json(updated.specs[index]);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.delete('/api/sdd/specs/:id', (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      const document = readSddProjectDocument(projectPath, requestSddVersion(req));
      if (!document.specs.some((spec) => spec.id === req.params.id)) return res.status(404).json({ error: 'Especificación no encontrada' });
      writeSddProjectDocument(projectPath, document.version, sddSpecsToMarkdown(document.specs.filter((spec) => spec.id !== req.params.id)));
      return res.status(204).end();
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/sdd/specs/sync', (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      const markdown = typeof req.body?.markdown === 'string' ? req.body.markdown : '';
      const document = readSddProjectDocument(projectPath, requestSddVersion(req));
      writeSddProjectDocument(projectPath, document.version, markdown);
      const updated = readSddProjectDocument(projectPath, document.version);
      return res.json({ version: updated.version, total: updated.specs.length, pendingTotal: updated.pendingTotal, specs: updated.specs });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.get('/api/sdd/specs/markdown', (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      const document = readSddProjectDocument(projectPath, requestSddVersion(req));
      const versionPath = resolveSddVersion(projectPath, document.version).version.path;
      return res.json({ path: versionPath, version: document.version, markdown: document.markdown });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.get('/api/sdd/report', async (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      const document = readSddProjectDocument(projectPath, requestSddVersion(req));
      const database = readSddDatabaseDocument(projectPath);
      const resources = await listSddResources(projectPath);
      return res.json(sddReport(projectPath, document, database.database, resources));
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.get('/api/sdd/db', (req, res) => {
    try {
      const document = readSddDatabaseDocument(requestSddProjectPath(req));
      return res.json({ tables: document.database.tables.map(tableForResponse) });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/sdd/db/tables', (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      const document = readSddDatabaseDocument(projectPath);
      const input = tableInput(req.body);
      const timestamp = new Date().toISOString();
      const table = { id: ID('sdd_table'), ...input, columns: [], createdAt: timestamp, updatedAt: timestamp };
      const database = { ...document.database, tables: [...document.database.tables, table] };
      writeSddDatabaseDocument(projectPath, database);
      const updated = readSddDatabaseDocument(projectPath);
      return res.status(201).json(tableForResponse(updated.database.tables.at(-1)));
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.put('/api/sdd/db/tables/:id', (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      const document = readSddDatabaseDocument(projectPath);
      const index = document.database.tables.findIndex((table) => table.id === req.params.id);
      if (index < 0) return res.status(404).json({ error: 'Tabla no encontrada' });
      const existing = document.database.tables[index];
      const input = tableInput(req.body, existing);
      const table = { ...existing, ...input, updatedAt: new Date().toISOString() };
      const database = { ...document.database, tables: document.database.tables.map((item, itemIndex) => itemIndex === index ? table : item) };
      writeSddDatabaseDocument(projectPath, database);
      return res.json(tableForResponse(table));
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.delete('/api/sdd/db/tables/:id', (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      const document = readSddDatabaseDocument(projectPath);
      if (!document.database.tables.some((table) => table.id === req.params.id)) return res.status(404).json({ error: 'Tabla no encontrada' });
      const database = { ...document.database, tables: document.database.tables.filter((table) => table.id !== req.params.id) };
      writeSddDatabaseDocument(projectPath, database);
      return res.status(204).end();
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/sdd/db/tables/:id/columns', (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      const document = readSddDatabaseDocument(projectPath);
      const tableIndex = document.database.tables.findIndex((table) => table.id === req.params.id);
      if (tableIndex < 0) return res.status(404).json({ error: 'Tabla no encontrada' });
      const table = document.database.tables[tableIndex];
      const input = columnInput(req.body);
      const column = { id: ID('sdd_column'), ...input, position: table.columns.length };
      const updatedTable = { ...table, columns: [...table.columns, column], updatedAt: new Date().toISOString() };
      const database = { ...document.database, tables: document.database.tables.map((item, index) => index === tableIndex ? updatedTable : item) };
      writeSddDatabaseDocument(projectPath, database);
      const updated = readSddDatabaseDocument(projectPath);
      const updatedTableFromDocument = updated.database.tables.find((item) => item.id === table.id);
      return res.status(201).json(columnForResponse(updatedTableFromDocument.columns.at(-1), updatedTableFromDocument.id));
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.put('/api/sdd/db/columns/:id', (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      const document = readSddDatabaseDocument(projectPath);
      let match = null;
      document.database.tables.forEach((table, tableIndex) => {
        const columnIndex = table.columns.findIndex((column) => column.id === req.params.id);
        if (columnIndex >= 0) match = { table, tableIndex, columnIndex };
      });
      if (!match) return res.status(404).json({ error: 'Columna no encontrada' });
      const existing = match.table.columns[match.columnIndex];
      const column = { ...existing, ...columnInput(req.body, existing) };
      const updatedTable = {
        ...match.table,
        updatedAt: new Date().toISOString(),
        columns: match.table.columns.map((item, index) => index === match.columnIndex ? column : item)
      };
      const database = { ...document.database, tables: document.database.tables.map((table, index) => index === match.tableIndex ? updatedTable : table) };
      writeSddDatabaseDocument(projectPath, database);
      return res.json(columnForResponse(column, match.table.id));
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.delete('/api/sdd/db/columns/:id', (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      const document = readSddDatabaseDocument(projectPath);
      let match = null;
      document.database.tables.forEach((table, tableIndex) => {
        if (table.columns.some((column) => column.id === req.params.id)) match = { table, tableIndex };
      });
      if (!match) return res.status(404).json({ error: 'Columna no encontrada' });
      const updatedTable = {
        ...match.table,
        updatedAt: new Date().toISOString(),
        columns: match.table.columns.filter((column) => column.id !== req.params.id)
      };
      const database = { ...document.database, tables: document.database.tables.map((table, index) => index === match.tableIndex ? updatedTable : table) };
      writeSddDatabaseDocument(projectPath, database);
      return res.status(204).end();
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.get('/api/sdd/resources', async (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      return res.json(await listSddResources(projectPath, {
        q: req.query?.q,
        kind: req.query?.kind,
        folder: req.query?.folder
      }));
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/sdd/resources', async (req, res) => {
    let temporaryPath = '';
    try {
      const projectPath = requestSddProjectPath(req);
      assertVersionedSddProject(projectPath);
      const requestedName = asText(req.query?.fileName || req.query?.name, 'recurso');
      const fileName = uniqueResourceFileName(projectPath, requestedName);
      const destination = safeResourcePath(projectPath, fileName);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      temporaryPath = `${destination}.upload-${crypto.randomUUID()}`;
      const size = await streamRequestToFile(req, temporaryPath, RESOURCE_MAX_BYTES);
      if (!size) throw new Error('El archivo está vacío');
      const detected = await detectResourceType(temporaryPath, { fileName, probeUnknown: true });
      const limit = resourceByteLimit(detected.kind);
      if (size > limit) {
        const label = detected.kind === 'image' ? '20 MB' : detected.kind === 'video' ? '100 MB' : detected.kind === 'audio' ? '100 MB' : '200 MB';
        const error = new Error(`El recurso supera el límite de ${label}`);
        error.code = 'PAYLOAD_TOO_LARGE';
        throw error;
      }
      fs.renameSync(temporaryPath, destination);
      temporaryPath = '';
      const updated = await listSddResources(projectPath);
      const resource = updated.resources.find((item) => item.relativePath.toLowerCase() === fileName.toLowerCase());
      return res.status(201).json(resource || { relativePath: fileName });
    } catch (error) {
      if (temporaryPath) {
        try { fs.rmSync(temporaryPath, { force: true }); } catch { /* limpieza best effort */ }
      }
      return res.status(error.code === 'PAYLOAD_TOO_LARGE' ? 413 : 400).json({ error: error.message });
    }
  });

  app.post('/api/sdd/resources/folders', (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      assertVersionedSddProject(projectPath);
      const requestedName = asText(req.body?.path || req.body?.name);
      if (!requestedName) throw new Error('Indica el nombre de la carpeta');
      const { fileName, destination } = resourceDestinationPath(projectPath, requestedName);
      if (fs.existsSync(destination)) return res.status(409).json({ error: 'La carpeta o el recurso ya existe' });
      fs.mkdirSync(destination, { recursive: true });
      return res.status(201).json({
        name: path.posix.basename(fileName),
        relativePath: fileName,
        directory: path.posix.dirname(fileName) === '.' ? '' : path.posix.dirname(fileName),
        path: destination,
        kind: 'folder'
      });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.patch('/api/sdd/resources', async (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      assertVersionedSddProject(projectPath);
      const oldName = normaliseResourceName(req.body?.fileName || req.body?.path);
      const oldPath = safeResourcePath(projectPath, oldName);
      if (!fs.existsSync(oldPath)) return res.status(404).json({ error: 'Recurso o carpeta no encontrado' });
      const stats = fs.statSync(oldPath);
      const requestedNewName = asText(req.body?.newName || req.body?.name);
      if (!requestedNewName) throw new Error('Indica el nuevo nombre');
      const parent = path.posix.dirname(oldName);
      const targetName = requestedNewName.includes('/') || requestedNewName.includes('\\')
        ? requestedNewName
        : parent === '.' ? requestedNewName : `${parent}/${requestedNewName}`;
      const { fileName: newName, destination } = resourceDestinationPath(projectPath, targetName);
      if (destination === oldPath || fs.existsSync(destination)) return res.status(409).json({ error: 'Ya existe un recurso o carpeta con ese nombre' });
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.renameSync(oldPath, destination);
      const paths = resolveSddPaths(projectPath);
      let updatedReferences = false;
      const markdownPaths = [
        ...listSddVersions(projectPath).map((version) => version.path),
        paths.databasePath
      ];
      for (const markdownPath of markdownPaths) {
        if (!fs.existsSync(markdownPath)) continue;
        const markdown = fs.readFileSync(markdownPath, 'utf8');
        const updatedMarkdown = replaceResourceReferences(markdown, oldName, newName, { directory: stats.isDirectory() });
        if (updatedMarkdown === markdown) continue;
        fs.writeFileSync(markdownPath, updatedMarkdown, { encoding: 'utf8', mode: 0o600 });
        updatedReferences = true;
      }
      if (updatedReferences) syncFullSpecsMarkdown(projectPath);
      return res.json({
        renamed: true,
        oldName,
        newName,
        updatedReferences,
        ...(await listSddResources(projectPath))
      });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.delete('/api/sdd/resources', (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      assertVersionedSddProject(projectPath);
      const name = normaliseResourceName(req.body?.fileName || req.body?.path || req.query?.fileName);
      const target = safeResourcePath(projectPath, name);
      if (!fs.existsSync(target)) return res.status(404).json({ error: 'Recurso o carpeta no encontrado' });
      const stats = fs.statSync(target);
      const referencedNames = resourceNamesInside(projectPath, name, stats.isDirectory());
      const references = referencedNames.flatMap((resourceName) => referencedResourceFiles(projectPath, resourceName));
      const uniqueReferences = references.filter((reference, index, list) => list.findIndex((item) => item.label === reference.label) === index);
      const confirmed = asBoolean(req.body?.confirmReferences, false) || ['1', 'true', 'yes', 'si', 'sí'].includes(String(req.query?.confirmReferences || '').toLowerCase());
      if (uniqueReferences.length && !confirmed) {
        return res.status(409).json({
          code: 'RESOURCE_REFERENCES',
          error: `El recurso está referenciado ${uniqueReferences.length} ${uniqueReferences.length === 1 ? 'vez' : 'veces'} en las especificaciones`,
          references: uniqueReferences
        });
      }
      if (stats.isDirectory()) fs.rmSync(target, { recursive: true, force: true });
      else fs.rmSync(target, { force: true });
      return res.json({ deleted: name, referencesPreserved: uniqueReferences.length > 0, references: uniqueReferences });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  const sendSddResourceFile = async (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      assertVersionedSddProject(projectPath);
      const name = normaliseResourceName(req.query?.fileName);
      const filePath = safeResourcePath(projectPath, name);
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return res.status(404).json({ error: 'Recurso no encontrado' });
      const detected = await detectResourceType(filePath, { fileName: name, probeUnknown: true });
      if (req.query?.transcode === '1' || req.query?.transcode === 'true') {
        if (detected.kind !== 'audio') return res.status(415).json({ error: 'El recurso no es un audio' });
        return transcodeAudioToMp3(req, res, filePath);
      }
      if (fs.statSync(filePath).size > resourceByteLimit(detected.kind)) return res.status(413).json({ error: 'El recurso supera el tamaño máximo compatible' });
      return streamFileWithRanges(req, res, filePath, detected.mime, { download: req.query?.download === '1' });
    } catch (error) {
      return res.status(404).json({ error: error.message || 'Recurso no encontrado' });
    }
  };
  app.get('/api/sdd/resources/file', sendSddResourceFile);
  app.head('/api/sdd/resources/file', sendSddResourceFile);
  app.get('/api/sdd/resources/transcode', (req, res) => {
    req.query.transcode = '1';
    return sendSddResourceFile(req, res);
  });

}

module.exports = {
  installSddRoutes,
  parseSddDocument,
  parseSddSpecsMarkdown,
  sddDocumentToMarkdown,
  sddSpecsToMarkdown,
  pendingSddSpecs,
  isCompletedSpecStatus,
  resolveSddPaths,
  SDD_FOLDER_NAME,
  SDD_SPECS_DIRECTORY,
  SDD_LEGACY_SPECS_FILENAME,
  SDD_FULL_FILENAME,
  SDD_DATABASE_FILENAME
};
