const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');

const ID = (prefix) => `${prefix}_${crypto.randomUUID()}`;
const SPEC_STATUSES = Object.freeze(['draft', 'active', 'approved', 'implemented']);
const SPEC_STATUS_BY_LABEL = Object.freeze({
  draft: 'draft', borrador: 'draft', active: 'active', activa: 'active',
  approved: 'approved', aprobada: 'approved', implemented: 'implemented', implementada: 'implemented'
});
const MEDIA_KINDS = Object.freeze(['text', 'image', 'video']);
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
  mov: 'video/quicktime'
});
const IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
const TEXT_MAX_LENGTH = 20000;
const SDD_RESOURCES_DIRECTORY = 'specs_resources';
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

function upsertSddMetadata(markdown, kind, value) {
  const marker = SDD_METADATA_MARKERS[kind];
  const block = `${marker.start}\n${JSON.stringify(value, null, 2)}\n${marker.end}`;
  const source = String(markdown ?? '');
  if (source.includes(marker.start) || source.includes(marker.end)) {
    extractSddMetadata(source, kind);
    return source.replace(metadataPattern(kind), block);
  }
  return `${source.replace(/\s*$/, '')}\n\n${block}\n`;
}

function normalizeDatabase(value) {
  const rawTables = Array.isArray(value?.tables) ? value.tables : [];
  const tables = rawTables.map((rawTable, tableIndex) => {
    const name = sliceText(asText(rawTable?.name), 120);
    const id = asText(rawTable?.id) || stableId('sdd_table', `${tableIndex}:${name}`);
    const rawColumns = Array.isArray(rawTable?.columns) ? rawTable.columns : [];
    const columns = rawColumns.map((rawColumn, columnIndex) => {
      const columnName = sliceText(asText(rawColumn?.name), 120);
      return {
        id: asText(rawColumn?.id) || stableId('sdd_column', `${id}:${columnIndex}:${columnName}`),
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
      id: asText(rawItem?.id) || stableId('media', `${index}:${kind}:${title}`),
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
    id: row.id || stableId('spec', `${index}:${row.title}`),
    title: row.title,
    description: row.description,
    status: row.status,
    category: row.category,
    createdAt: row.createdAt || row.created_at || timestamp,
    updatedAt: row.updatedAt || row.updated_at || timestamp
  };
}

function specsWithIdentity(specs, timestamp = null) {
  return specs.map((spec, index) => specForResponse({ ...spec, id: spec.id || stableId('spec', `${index}:${spec.title}`) }, index, timestamp));
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

function mediaForResponse(item, projectPath) {
  const response = {
    id: item.id,
    title: item.title,
    description: item.description,
    kind: item.kind,
    content: item.content,
    fileName: item.fileName || null,
    fileUrl: null,
    fileMissing: false,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt
  };
  if (!item.fileName) return response;
  try {
    const filePath = safeResourcePath(projectPath, item.fileName);
    const buffer = fs.readFileSync(filePath);
    const mime = mimeForFileName(item.fileName) || 'application/octet-stream';
    response.fileUrl = `data:${mime};base64,${buffer.toString('base64')}`;
  } catch {
    response.fileMissing = true;
  }
  return response;
}

function specInput(body, existing = null) {
  const title = asText(body?.title, existing?.title || '').slice(0, 200);
  if (!title) throw new Error('Indica un título para la especificación');
  return {
    title,
    description: sliceText(body?.description, 10000),
    status: SPEC_STATUSES.includes(body?.status) ? body.status : (existing?.status || 'draft'),
    category: asText(body?.category).slice(0, 60)
  };
}

function normalizeSpecValue(raw, map, fallback) {
  const value = String(raw || '').trim().toLowerCase();
  return value ? (map[value] || fallback) : fallback;
}

function parseSddSpecsMarkdown(markdown) {
  const lines = stripSddMetadata(markdown).split(/\r?\n/);
  const specs = [];
  let current = null;
  let description = [];

  function flush() {
    if (!current) return;
    specs.push({ ...current, description: description.join('\n').trim().replace(/\n{3,}/g, '\n\n') });
    description = [];
  }

  const metadata = /^\s*(?:[-*]\s*)?(?:\*\*)?(estado|prioridad|categoría)(?:\*\*)?\s*[:：]\s*(.+)$/i;
  const identity = /^\s*<!--\s*nexusdata:sdd-spec-id:([A-Za-z0-9_-]+)\s*-->\s*$/i;
  const heading = /^#{2,4}\s+(.+)$/;

  for (const rawLine of lines) {
    const headingMatch = heading.exec(rawLine);
    if (headingMatch) {
      flush();
      const title = headingMatch[1].trim().replace(/\*\*/g, '').slice(0, 200);
      if (title) current = { title, description: '', status: 'draft', category: '' };
      continue;
    }
    if (!current) continue;
    const line = rawLine.trim();
    if (!line) continue;
    const identityMatch = identity.exec(line);
    if (identityMatch) {
      current.id = identityMatch[1];
      continue;
    }
    const metadataMatch = metadata.exec(line);
    if (metadataMatch) {
      const key = metadataMatch[1].toLowerCase();
      const value = metadataMatch[2].trim().replace(/^\*+\s*|\s*\*+$/g, '').trim();
      if (key === 'estado') current.status = normalizeSpecValue(value, SPEC_STATUS_BY_LABEL, current.status);
      else if (key === 'prioridad') continue;
      else current.category = value.slice(0, 60);
      continue;
    }
    description.push(line);
  }
  flush();
  return specs;
}

const SPEC_STATUS_LABELS = Object.freeze({ draft: 'Borrador', active: 'Activa', approved: 'Aprobada', implemented: 'Implementada' });

function sddSpecsToMarkdown(specs) {
  if (!specs.length) return '';
  const blocks = specs.map((spec) => {
    const lines = [`## ${spec.title}`, `**Estado:** ${SPEC_STATUS_LABELS[spec.status] || spec.status}`];
    if (spec.id) lines.splice(1, 0, `<!-- nexusdata:sdd-spec-id:${spec.id} -->`);
    if (spec.category) lines.push(`**Categoría:** ${spec.category}`);
    if (spec.description) lines.push('', spec.description.trim());
    return lines.join('\n');
  });
  return `# Specs\n\n${blocks.join('\n\n')}\n`;
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

  const specsPath = path.join(projectPath, 'specs.md');
  if (!fs.existsSync(specsPath) || !fs.statSync(specsPath).isFile()) {
    throw new Error('El proyecto no contiene un archivo specs.md');
  }
  const resourcesPath = path.join(projectPath, SDD_RESOURCES_DIRECTORY);
  if (!fs.existsSync(resourcesPath) || !fs.statSync(resourcesPath).isDirectory()) {
    throw new Error('El proyecto no contiene la carpeta specs_resources');
  }
  return projectPath;
}

function projectResponse(projectPath, name = '') {
  return {
    loaded: true,
    project: {
      name: name || path.basename(projectPath) || projectPath,
      path: projectPath,
      specsPath: path.join(projectPath, 'specs.md'),
      resourcesPath: path.join(projectPath, SDD_RESOURCES_DIRECTORY)
    }
  };
}

function readSddProjectDocument(projectPath) {
  const specsPath = path.join(projectPath, 'specs.md');
  const rawMarkdown = fs.readFileSync(specsPath, 'utf8');
  if (!rawMarkdown.trim()) throw new Error('specs.md está vacío');
  const markdown = stripSddMetadata(rawMarkdown);
  const parsedSpecs = parseSddSpecsMarkdown(markdown);
  if (!parsedSpecs.length) throw new Error('No se encontraron specs en specs.md');
  const timestamp = fs.statSync(specsPath).mtime.toISOString();
  return {
    rawMarkdown,
    markdown,
    specs: specsWithIdentity(parsedSpecs, timestamp),
    database: normalizeDatabase(extractSddMetadata(rawMarkdown, 'database')),
    media: normalizeMedia(extractSddMetadata(rawMarkdown, 'ui')),
    timestamp
  };
}

function writeSddProjectDocument(projectPath, markdown, database, media) {
  const cleanMarkdown = stripSddMetadata(markdown);
  if (!cleanMarkdown.trim()) throw new Error('specs.md no puede quedar vacío');
  let output = cleanMarkdown.replace(/\s*$/, '') + '\n';
  output = upsertSddMetadata(output, 'database', normalizeDatabase(database));
  output = upsertSddMetadata(output, 'ui', normalizeMedia(media));
  fs.writeFileSync(path.join(projectPath, 'specs.md'), output, { encoding: 'utf8', mode: 0o600 });
  return output;
}

function requestSddProjectPath(req, { required = true } = {}) {
  const candidate = req.get('x-sdd-project-path') || req.query?.projectPath || '';
  if (!candidate && !required) return '';
  return validateSddProjectPath(candidate);
}

function safeResourcePath(projectPath, fileName) {
  const rawName = String(fileName || '').trim();
  if (!rawName || path.isAbsolute(rawName)) throw new Error('El nombre del recurso no es válido');
  const resourceRoot = fs.realpathSync(path.join(projectPath, SDD_RESOURCES_DIRECTORY));
  const candidate = path.resolve(resourceRoot, rawName);
  if (candidate !== resourceRoot && !candidate.startsWith(`${resourceRoot}${path.sep}`)) {
    throw new Error('El recurso está fuera de specs_resources');
  }
  if (fs.existsSync(candidate)) {
    const realCandidate = fs.realpathSync(candidate);
    if (realCandidate !== resourceRoot && !realCandidate.startsWith(`${resourceRoot}${path.sep}`)) {
      throw new Error('El recurso está fuera de specs_resources');
    }
  }
  return candidate;
}

function uniqueResourceFileName(projectPath, originalName) {
  const extension = path.extname(path.basename(String(originalName || ''))).toLowerCase();
  const stem = path.basename(String(originalName || 'recurso'), extension)
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'recurso';
  let fileName = `${stem}${extension}`;
  let index = 1;
  while (fs.existsSync(safeResourcePath(projectPath, fileName))) {
    fileName = `${stem}-${index}${extension}`;
    index += 1;
  }
  return fileName;
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
      const document = readSddProjectDocument(projectPath);
      return res.json({ ...projectResponse(projectPath), markdown: document.markdown, total: document.specs.length, specs: document.specs });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.post(['/api/sdd/project', '/api/sdd/project/load'], (req, res) => {
    try {
      const projectPath = validateSddProjectPath(req.body?.path || req.body?.projectPath);
      const document = readSddProjectDocument(projectPath);
      const name = (asText(req.body?.name) || path.basename(projectPath) || 'Proyecto S.D.D').slice(0, 120);
      return res.json({ ...projectResponse(projectPath, name), markdown: document.markdown, total: document.specs.length, specs: document.specs });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  // El servidor no conserva un proyecto activo: descargar el contexto solo es una operación del renderer.
  app.delete('/api/sdd/project', (_req, res) => res.status(204).end());

  app.get('/api/sdd/specs', (req, res) => {
    try {
      const document = readSddProjectDocument(requestSddProjectPath(req));
      return res.json({ specs: document.specs });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/sdd/specs', (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      const document = readSddProjectDocument(projectPath);
      const input = specInput(req.body);
      const specs = [...document.specs, { ...input, createdAt: document.timestamp, updatedAt: document.timestamp }];
      writeSddProjectDocument(projectPath, sddSpecsToMarkdown(specs), document.database, document.media);
      const updated = readSddProjectDocument(projectPath);
      return res.status(201).json(updated.specs[updated.specs.length - 1]);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.put('/api/sdd/specs/:id', (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      const document = readSddProjectDocument(projectPath);
      const index = document.specs.findIndex((spec) => spec.id === req.params.id);
      if (index < 0) return res.status(404).json({ error: 'Especificación no encontrada' });
      const input = specInput(req.body, document.specs[index]);
      const specs = document.specs.map((spec, itemIndex) => itemIndex === index ? { ...spec, ...input, updatedAt: document.timestamp } : spec);
      writeSddProjectDocument(projectPath, sddSpecsToMarkdown(specs), document.database, document.media);
      const updated = readSddProjectDocument(projectPath);
      return res.json(updated.specs[index]);
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.delete('/api/sdd/specs/:id', (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      const document = readSddProjectDocument(projectPath);
      if (!document.specs.some((spec) => spec.id === req.params.id)) return res.status(404).json({ error: 'Especificación no encontrada' });
      writeSddProjectDocument(projectPath, sddSpecsToMarkdown(document.specs.filter((spec) => spec.id !== req.params.id)), document.database, document.media);
      return res.status(204).end();
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/sdd/specs/sync', (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      const markdown = typeof req.body?.markdown === 'string' ? req.body.markdown : '';
      const parsed = parseSddSpecsMarkdown(markdown);
      if (!parsed.length) throw new Error('No se encontraron specs en el markdown');
      const document = readSddProjectDocument(projectPath);
      writeSddProjectDocument(projectPath, markdown, document.database, document.media);
      const updated = readSddProjectDocument(projectPath);
      return res.json({ total: updated.specs.length, specs: updated.specs });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.get('/api/sdd/specs/markdown', (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      const document = readSddProjectDocument(projectPath);
      return res.json({ path: projectPath, markdown: document.markdown });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.get('/api/sdd/db', (req, res) => {
    try {
      const document = readSddProjectDocument(requestSddProjectPath(req));
      return res.json({ tables: document.database.tables.map(tableForResponse) });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/sdd/db/tables', (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      const document = readSddProjectDocument(projectPath);
      const input = tableInput(req.body);
      const timestamp = new Date().toISOString();
      const table = { id: ID('sdd_table'), ...input, columns: [], createdAt: timestamp, updatedAt: timestamp };
      const database = { ...document.database, tables: [...document.database.tables, table] };
      writeSddProjectDocument(projectPath, document.markdown, database, document.media);
      return res.status(201).json(tableForResponse(table));
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.put('/api/sdd/db/tables/:id', (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      const document = readSddProjectDocument(projectPath);
      const index = document.database.tables.findIndex((table) => table.id === req.params.id);
      if (index < 0) return res.status(404).json({ error: 'Tabla no encontrada' });
      const existing = document.database.tables[index];
      const input = tableInput(req.body, existing);
      const table = { ...existing, ...input, updatedAt: new Date().toISOString() };
      const database = { ...document.database, tables: document.database.tables.map((item, itemIndex) => itemIndex === index ? table : item) };
      writeSddProjectDocument(projectPath, document.markdown, database, document.media);
      return res.json(tableForResponse(table));
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.delete('/api/sdd/db/tables/:id', (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      const document = readSddProjectDocument(projectPath);
      if (!document.database.tables.some((table) => table.id === req.params.id)) return res.status(404).json({ error: 'Tabla no encontrada' });
      const database = { ...document.database, tables: document.database.tables.filter((table) => table.id !== req.params.id) };
      writeSddProjectDocument(projectPath, document.markdown, database, document.media);
      return res.status(204).end();
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/sdd/db/tables/:id/columns', (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      const document = readSddProjectDocument(projectPath);
      const tableIndex = document.database.tables.findIndex((table) => table.id === req.params.id);
      if (tableIndex < 0) return res.status(404).json({ error: 'Tabla no encontrada' });
      const table = document.database.tables[tableIndex];
      const input = columnInput(req.body);
      const column = { id: ID('sdd_column'), ...input, position: table.columns.length };
      const updatedTable = { ...table, columns: [...table.columns, column], updatedAt: new Date().toISOString() };
      const database = { ...document.database, tables: document.database.tables.map((item, index) => index === tableIndex ? updatedTable : item) };
      writeSddProjectDocument(projectPath, document.markdown, database, document.media);
      return res.status(201).json(columnForResponse(column, table.id));
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.put('/api/sdd/db/columns/:id', (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      const document = readSddProjectDocument(projectPath);
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
      writeSddProjectDocument(projectPath, document.markdown, database, document.media);
      return res.json(columnForResponse(column, match.table.id));
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.delete('/api/sdd/db/columns/:id', (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      const document = readSddProjectDocument(projectPath);
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
      writeSddProjectDocument(projectPath, document.markdown, database, document.media);
      return res.status(204).end();
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.get('/api/sdd/media', (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      const document = readSddProjectDocument(projectPath);
      return res.json({ media: document.media.media.map((item) => mediaForResponse(item, projectPath)) });
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.post('/api/sdd/media', express.raw({ limit: '200mb', type: 'application/octet-stream' }), (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      const document = readSddProjectDocument(projectPath);
      const kind = MEDIA_KINDS.includes(req.query?.kind) ? req.query.kind : '';
      const title = asText(req.query?.title).slice(0, 200);
      if (!title) throw new Error('Indica un título para el contenido');
      const description = sliceText(req.query?.description, 5000);
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const id = ID('media');
      const timestamp = new Date().toISOString();
      let fileName = '';
      let content = '';
      if (kind === 'text') {
        content = body.toString('utf8').slice(0, TEXT_MAX_LENGTH);
        if (!content.trim()) throw new Error('Escribe un texto para el contenido');
      } else if (kind === 'image' || kind === 'video') {
        const originalName = path.basename(String(req.query?.fileName || 'archivo'));
        const mime = mimeForFileName(originalName);
        if (!mime || (kind === 'image' && !mime.startsWith('image/')) || (kind === 'video' && !mime.startsWith('video/'))) {
          throw new Error('El formato del archivo no es compatible');
        }
        const maxBytes = kind === 'image' ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES;
        if (body.length > maxBytes) throw new Error('El archivo supera el límite de tamaño permitido');
        if (!body.length) throw new Error('El archivo está vacío');
        fileName = uniqueResourceFileName(projectPath, originalName);
        fs.writeFileSync(safeResourcePath(projectPath, fileName), body, { mode: 0o600 });
      } else {
        throw new Error('Indica el tipo de contenido: texto, imagen o vídeo');
      }
      const item = { id, title, description, kind, content, fileName, createdAt: timestamp, updatedAt: timestamp };
      const media = { ...document.media, media: [...document.media.media, item] };
      writeSddProjectDocument(projectPath, document.markdown, document.database, media);
      return res.status(201).json(mediaForResponse(item, projectPath));
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.put('/api/sdd/media/:id', (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      const document = readSddProjectDocument(projectPath);
      const index = document.media.media.findIndex((item) => item.id === req.params.id);
      if (index < 0) return res.status(404).json({ error: 'Contenido no encontrado' });
      const existing = document.media.media[index];
      const input = mediaInput(req.body, existing);
      const item = { ...existing, ...input, updatedAt: new Date().toISOString() };
      const media = { ...document.media, media: document.media.media.map((current, itemIndex) => itemIndex === index ? item : current) };
      writeSddProjectDocument(projectPath, document.markdown, document.database, media);
      return res.json(mediaForResponse(item, projectPath));
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.delete('/api/sdd/media/:id', (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      const document = readSddProjectDocument(projectPath);
      if (!document.media.media.some((item) => item.id === req.params.id)) return res.status(404).json({ error: 'Contenido no encontrado' });
      const media = { ...document.media, media: document.media.media.filter((item) => item.id !== req.params.id) };
      // El fichero no se elimina: sigue siendo un recurso válido del proyecto y debe continuar visible en Recursos.
      writeSddProjectDocument(projectPath, document.markdown, document.database, media);
      return res.status(204).end();
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  });

  app.get('/api/sdd/media/:id/file', (req, res) => {
    try {
      const projectPath = requestSddProjectPath(req);
      const document = readSddProjectDocument(projectPath);
      const item = document.media.media.find((media) => media.id === req.params.id);
      if (!item?.fileName) return res.status(404).json({ error: 'Archivo no encontrado' });
      const filePath = safeResourcePath(projectPath, item.fileName);
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return res.status(404).json({ error: 'Archivo no encontrado' });
      res.set('Content-Type', mimeForFileName(item.fileName) || 'application/octet-stream');
      res.set('Cache-Control', 'no-store');
      return fs.createReadStream(filePath).pipe(res);
    } catch {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }
  });
}

module.exports = { installSddRoutes, parseSddSpecsMarkdown, sddSpecsToMarkdown };
