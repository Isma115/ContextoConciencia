const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { now } = require('../database/db');

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
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg'
});
const IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const VIDEO_MAX_BYTES = 100 * 1024 * 1024;
const TEXT_MAX_LENGTH = 20000;
const SAFE_FILE_NAME = /^[A-Za-z0-9._-]+$/;

function asText(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function sliceText(value, maxLength) {
  return String(value ?? '').slice(0, maxLength);
}

function specForResponse(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    category: row.category,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function columnForResponse(row) {
  return {
    id: row.id,
    tableId: row.table_id,
    name: row.name,
    type: row.type,
    nullable: Number(row.nullable) === 1,
    primaryKey: Number(row.primary_key) === 1,
    defaultValue: row.default_value,
    description: row.description,
    position: Number(row.position)
  };
}

function tableForResponse(row, columns = []) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    columns
  };
}

function mediaForResponse(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    kind: row.kind,
    content: row.content,
    fileName: row.file_name || null,
    fileUrl: row.file_name ? `/api/sdd/media/${row.id}/file` : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function tableColumns(db, tableId) {
  return db.all('SELECT * FROM sdd_columns WHERE table_id = ? ORDER BY position ASC, id ASC', tableId).map(columnForResponse);
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
  const lines = String(markdown ?? '').split(/\r?\n/);
  const specs = [];
  let current = null;
  let description = [];

  function flush() {
    if (!current) return;
    specs.push({ ...current, description: description.join('\n').trim().replace(/\n{3,}/g, '\n\n') });
    description = [];
  }

  const metadata = /^\s*(?:[-*]\s*)?(?:\*\*)?(estado|prioridad|categoría)(?:\*\*)?\s*[:：]\s*(.+)$/i;
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
  const blocks = specs.map((spec) => {
    const lines = [`## ${spec.title}`, `**Estado:** ${SPEC_STATUS_LABELS[spec.status] || spec.status}`];
    if (spec.category) lines.push(`**Categoría:** ${spec.category}`);
    if (spec.description) lines.push('', spec.description.trim());
    return lines.join('\n');
  });
  return `# Specs\n\n${blocks.join('\n\n')}\n`;
}

function tableInput(body, existing = null) {
  const name = asText(body?.name, existing?.name || '').slice(0, 120);
  if (!name) throw new Error('Indica un nombre para la tabla');
  return {
    name,
    description: sliceText(body?.description, 2000)
  };
}

function columnInput(body, existing = null) {
  const name = asText(body?.name, existing?.name || '').slice(0, 120);
  if (!name) throw new Error('Indica un nombre para la columna');
  return {
    name,
    type: asText(body?.type, existing?.type || '').slice(0, 60),
    nullable: Boolean(body?.nullable),
    primaryKey: Boolean(body?.primaryKey),
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

function installSddRoutes(app, db, { mediaRoot } = {}) {
  const resolvedMediaRoot = mediaRoot || path.join(process.cwd(), 'data', 'sdd-media');
  fs.mkdirSync(resolvedMediaRoot, { recursive: true });

  app.get('/api/sdd/specs', (_req, res) => {
    const rows = db.all('SELECT * FROM sdd_specs ORDER BY updated_at DESC');
    res.json({ specs: rows.map(specForResponse) });
  });

  app.post('/api/sdd/specs', (req, res) => {
    try {
      const input = specInput(req.body);
      const id = ID('spec');
      const timestamp = now();
      db.run('INSERT INTO sdd_specs (id, title, description, status, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        id, input.title, input.description, input.status, input.category, timestamp, timestamp);
      res.status(201).json(specForResponse(db.get('SELECT * FROM sdd_specs WHERE id = ?', id)));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.put('/api/sdd/specs/:id', (req, res) => {
    const existing = db.get('SELECT * FROM sdd_specs WHERE id = ?', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Especificación no encontrada' });
    try {
      const input = specInput(req.body, existing);
      db.run('UPDATE sdd_specs SET title = ?, description = ?, status = ?, category = ?, updated_at = ? WHERE id = ?',
        input.title, input.description, input.status, input.category, now(), existing.id);
      res.json(specForResponse(db.get('SELECT * FROM sdd_specs WHERE id = ?', existing.id)));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete('/api/sdd/specs/:id', (req, res) => {
    if (!db.get('SELECT id FROM sdd_specs WHERE id = ?', req.params.id)) return res.status(404).json({ error: 'Especificación no encontrada' });
    db.run('DELETE FROM sdd_specs WHERE id = ?', req.params.id);
    res.status(204).end();
  });

  app.post('/api/sdd/specs/sync', (req, res) => {
    try {
      const parsed = parseSddSpecsMarkdown(req.body?.markdown);
      if (!parsed.length) throw new Error('No se encontraron specs en el markdown');
      db.transaction(() => {
        db.run('DELETE FROM sdd_specs');
        const timestamp = now();
        for (const spec of parsed) {
          const id = ID('spec');
          db.run('INSERT INTO sdd_specs (id, title, description, status, category, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
            id, spec.title, spec.description, spec.status, spec.category, timestamp, timestamp);
        }
      });
      const rows = db.all('SELECT * FROM sdd_specs ORDER BY updated_at DESC');
      res.json({ total: rows.length, specs: rows.map(specForResponse) });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get('/api/sdd/specs/markdown', (_req, res) => {
    const rows = db.all('SELECT * FROM sdd_specs ORDER BY updated_at DESC');
    res.json({ markdown: sddSpecsToMarkdown(rows.map(specForResponse)) });
  });

  app.get('/api/sdd/db', (_req, res) => {
    const rows = db.all('SELECT * FROM sdd_tables ORDER BY created_at ASC, id ASC');
    res.json({ tables: rows.map((row) => tableForResponse(row, tableColumns(db, row.id))) });
  });

  app.post('/api/sdd/db/tables', (req, res) => {
    try {
      const input = tableInput(req.body);
      const id = ID('sdd_table');
      const timestamp = now();
      db.run('INSERT INTO sdd_tables (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        id, input.name, input.description, timestamp, timestamp);
      res.status(201).json(tableForResponse(db.get('SELECT * FROM sdd_tables WHERE id = ?', id)));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.put('/api/sdd/db/tables/:id', (req, res) => {
    const existing = db.get('SELECT * FROM sdd_tables WHERE id = ?', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Tabla no encontrada' });
    try {
      const input = tableInput(req.body, existing);
      db.run('UPDATE sdd_tables SET name = ?, description = ?, updated_at = ? WHERE id = ?', input.name, input.description, now(), existing.id);
      const row = db.get('SELECT * FROM sdd_tables WHERE id = ?', existing.id);
      res.json(tableForResponse(row, tableColumns(db, row.id)));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete('/api/sdd/db/tables/:id', (req, res) => {
    if (!db.get('SELECT id FROM sdd_tables WHERE id = ?', req.params.id)) return res.status(404).json({ error: 'Tabla no encontrada' });
    db.run('DELETE FROM sdd_tables WHERE id = ?', req.params.id);
    res.status(204).end();
  });

  app.post('/api/sdd/db/tables/:id/columns', (req, res) => {
    const table = db.get('SELECT id FROM sdd_tables WHERE id = ?', req.params.id);
    if (!table) return res.status(404).json({ error: 'Tabla no encontrada' });
    try {
      const input = columnInput(req.body);
      const id = ID('sdd_column');
      const position = Number(db.get('SELECT COALESCE(MAX(position), 0) + 1 AS position FROM sdd_columns WHERE table_id = ?', table.id).position);
      db.run('INSERT INTO sdd_columns (id, table_id, name, type, nullable, primary_key, default_value, description, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id, table.id, input.name, input.type, input.nullable ? 1 : 0, input.primaryKey ? 1 : 0, input.defaultValue, input.description, position);
      res.status(201).json(columnForResponse(db.get('SELECT * FROM sdd_columns WHERE id = ?', id)));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.put('/api/sdd/db/columns/:id', (req, res) => {
    const existing = db.get('SELECT * FROM sdd_columns WHERE id = ?', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Columna no encontrada' });
    try {
      const input = columnInput(req.body, existing);
      db.run('UPDATE sdd_columns SET name = ?, type = ?, nullable = ?, primary_key = ?, default_value = ?, description = ? WHERE id = ?',
        input.name, input.type, input.nullable ? 1 : 0, input.primaryKey ? 1 : 0, input.defaultValue, input.description, existing.id);
      res.json(columnForResponse(db.get('SELECT * FROM sdd_columns WHERE id = ?', existing.id)));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete('/api/sdd/db/columns/:id', (req, res) => {
    if (!db.get('SELECT id FROM sdd_columns WHERE id = ?', req.params.id)) return res.status(404).json({ error: 'Columna no encontrada' });
    db.run('DELETE FROM sdd_columns WHERE id = ?', req.params.id);
    res.status(204).end();
  });

  app.get('/api/sdd/media', (_req, res) => {
    const rows = db.all('SELECT * FROM sdd_media ORDER BY updated_at DESC');
    res.json({ media: rows.map(mediaForResponse) });
  });

  app.post('/api/sdd/media', express.raw({ limit: '200mb', type: 'application/octet-stream' }), (req, res) => {
    try {
      const kind = MEDIA_KINDS.includes(req.query?.kind) ? req.query.kind : '';
      const title = asText(req.query?.title).slice(0, 200);
      if (!title) throw new Error('Indica un título para el contenido');
      const description = sliceText(req.query?.description, 5000);
      const body = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const id = ID('media');
      const timestamp = now();
      let fileName = '';
      let content = '';
      if (kind === 'text') {
        content = body.toString('utf8').slice(0, TEXT_MAX_LENGTH);
        if (!content.trim()) throw new Error('Escribe un texto para el contenido');
      } else if (kind === 'image' || kind === 'video') {
        const originalName = path.basename(String(req.query?.fileName || 'archivo'));
        const mime = mimeForFileName(originalName);
        if (!mime) throw new Error('El formato del archivo no es compatible');
        const maxBytes = kind === 'image' ? IMAGE_MAX_BYTES : VIDEO_MAX_BYTES;
        if (body.length > maxBytes) throw new Error('El archivo supera el límite de tamaño permitido');
        if (!body.length) throw new Error('El archivo está vacío');
        const extension = path.extname(originalName).toLowerCase();
        fileName = `${id}${extension}`;
        fs.writeFileSync(path.join(resolvedMediaRoot, fileName), body, { mode: 0o600 });
      } else {
        throw new Error('Indica el tipo de contenido: texto, imagen o vídeo');
      }
      db.run('INSERT INTO sdd_media (id, title, description, kind, content, file_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        id, title, description, kind, content, fileName, timestamp, timestamp);
      res.status(201).json(mediaForResponse(db.get('SELECT * FROM sdd_media WHERE id = ?', id)));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.put('/api/sdd/media/:id', (req, res) => {
    const existing = db.get('SELECT * FROM sdd_media WHERE id = ?', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Contenido no encontrado' });
    try {
      const input = mediaInput(req.body, existing);
      db.run('UPDATE sdd_media SET title = ?, description = ?, content = ?, updated_at = ? WHERE id = ?',
        input.title, input.description, input.content, now(), existing.id);
      res.json(mediaForResponse(db.get('SELECT * FROM sdd_media WHERE id = ?', existing.id)));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete('/api/sdd/media/:id', (req, res) => {
    const existing = db.get('SELECT * FROM sdd_media WHERE id = ?', req.params.id);
    if (!existing) return res.status(404).json({ error: 'Contenido no encontrado' });
    db.run('DELETE FROM sdd_media WHERE id = ?', existing.id);
    if (existing.file_name && SAFE_FILE_NAME.test(existing.file_name)) {
      try { fs.unlinkSync(path.join(resolvedMediaRoot, existing.file_name)); } catch { /* El archivo ya no existe. */ }
    }
    res.status(204).end();
  });

  app.get('/api/sdd/media/:id/file', (req, res) => {
    const existing = db.get('SELECT file_name FROM sdd_media WHERE id = ?', req.params.id);
    if (!existing || !existing.file_name || !SAFE_FILE_NAME.test(existing.file_name)) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }
    const filePath = path.join(resolvedMediaRoot, existing.file_name);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return res.status(404).json({ error: 'Archivo no encontrado' });
    }
    const mime = mimeForFileName(existing.file_name);
    res.set('Content-Type', mime || 'application/octet-stream');
    res.set('Cache-Control', 'private, max-age=3600');
    fs.createReadStream(filePath).pipe(res);
  });
}

module.exports = { installSddRoutes, parseSddSpecsMarkdown, sddSpecsToMarkdown };
