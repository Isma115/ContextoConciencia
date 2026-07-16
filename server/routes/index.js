const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const Fuse = require('fuse.js');
const { now, parseJson, sourceForResponse, withDocumentShape, documentSelect } = require('../database/db');
const { importLocalSource } = require('../importers/local');
const { syncRestSource, testRestSource } = require('../services/rest');
const { installAuthRoutes, requireAuth } = require('../auth');

const ID = (prefix) => `${prefix}_${crypto.randomUUID()}`;

function asText(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function sourceRow(db, id, { localOnly = false } = {}) {
  return db.get(
    `SELECT s.*, (SELECT COUNT(*) FROM documents d WHERE d.source_id = s.id) AS document_count
     FROM sources s WHERE s.id = ?${localOnly ? " AND s.type = 'local'" : ''}`,
    id
  );
}

function isOffline(req) {
  return req.user?.offline === true;
}

function localDocumentClause(localOnly) {
  return localOnly ? "s.type = 'local'" : '';
}

function offlineCollectionClause() {
  return `(
    NOT EXISTS (SELECT 1 FROM collection_items ci_all WHERE ci_all.collection_id = c.id)
    OR EXISTS (
      SELECT 1 FROM collection_items ci_local
      JOIN documents d_local ON d_local.id = ci_local.document_id
      JOIN sources s_local ON s_local.id = d_local.source_id
      WHERE ci_local.collection_id = c.id AND s_local.type = 'local'
    )
  )`;
}

function sourceConfig(body, existing = null) {
  const input = body.config && typeof body.config === 'object'
    ? body.config
    : existing
      ? parseJson(existing.config_json)
      : body;
  const config = { ...input };
  if (existing) {
    const old = parseJson(existing.config_json);
    if (old.headers && config.headers) {
      config.headers = Object.fromEntries(Object.entries(config.headers).map(([key, value]) => [
        key,
        value === '••••••••' || value === '********' ? old.headers[key] : value
      ]));
    }
  }
  return config;
}

function validateSourceInput(body, existing = null) {
  const name = asText(body.name, existing?.name || '');
  const type = asText(body.type, existing?.type || '');
  if (!name || name.length > 120) throw new Error('El nombre es obligatorio y debe tener menos de 120 caracteres');
  if (!['local', 'rest'].includes(type)) throw new Error('El tipo de fuente no es válido');
  const config = sourceConfig(body, existing);
  if (type === 'local') {
    const paths = Array.isArray(config.paths) ? [...new Set(config.paths.filter((value) => typeof value === 'string' && value.trim()))] : [];
    if (!paths.length) throw new Error('Selecciona al menos un archivo o carpeta');
    if (paths.length > 50) throw new Error('Una fuente puede tener como máximo 50 rutas');
    config.paths = paths.map((value) => path.resolve(value));
  } else {
    if (!config.url || !/^https?:\/\//i.test(config.url)) throw new Error('Indica una URL REST http o https');
    if (config.headers && typeof config.headers !== 'object') throw new Error('Las cabeceras deben ser un objeto JSON');
    config.headers = Object.fromEntries(Object.entries(config.headers || {}).slice(0, 30).map(([key, value]) => [String(key).slice(0, 120), String(value)]));
    config.mapping = {
      id: asText(config.mapping?.id, 'id'),
      title: asText(config.mapping?.title, 'title'),
      content: asText(config.mapping?.content, 'description')
    };
  }
  return { name, type, config };
}

function sourceResponse(db, source) {
  return sourceForResponse(sourceRow(db, source.id));
}

function setSourceStatus(db, id, status, lastError = null) {
  db.run('UPDATE sources SET status = ?, last_error = ? WHERE id = ?', status, lastError, id);
}

async function syncSource(db, source) {
  setSourceStatus(db, source.id, 'syncing', null);
  try {
    const result = source.type === 'local'
      ? importLocalSource(db, source)
      : await syncRestSource(db, source);
    const syncAt = now();
    db.run('UPDATE sources SET status = ?, last_sync_at = ?, last_error = NULL WHERE id = ?', 'ready', syncAt, source.id);
    return { ...result, syncedAt: syncAt, source: sourceResponse(db, source) };
  } catch (error) {
    setSourceStatus(db, source.id, 'error', error.message);
    error.syncSource = sourceResponse(db, source);
    throw error;
  }
}

function documentRows(db, query = {}, { localOnly = false } = {}) {
  const clauses = [];
  const params = [];
  if (localOnly) clauses.push(localDocumentClause(true));
  if (query.source) {
    clauses.push('d.source_id = ?');
    params.push(query.source);
  }
  if (query.type) {
    clauses.push('d.type = ?');
    params.push(query.type);
  }
  if (query.tag) {
    clauses.push('EXISTS (SELECT 1 FROM document_tags dt JOIN tags t ON t.id = dt.tag_id WHERE dt.document_id = d.id AND lower(t.name) = lower(?))');
    params.push(query.tag);
  }
  if (query.collection) {
    clauses.push('EXISTS (SELECT 1 FROM collection_items ci WHERE ci.document_id = d.id AND ci.collection_id = ?)');
    params.push(query.collection);
  }
  if (query.updatedFrom) {
    clauses.push('d.updated_at >= ?');
    params.push(query.updatedFrom);
  }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const limit = Math.min(Math.max(Number(query.limit) || 200, 1), 500);
  const rows = db.all(`${documentSelect()}${where} ORDER BY d.updated_at DESC LIMIT ${limit}`, ...params);
  return rows.map((row) => withDocumentShape(db, row));
}

function snippet(content, query) {
  const clean = String(content || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (!query) return clean.slice(0, 220);
  const index = clean.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  if (index < 0) return clean.slice(0, 220);
  const start = Math.max(0, index - 75);
  const end = Math.min(clean.length, index + query.length + 145);
  return `${start ? '…' : ''}${clean.slice(start, end)}${end < clean.length ? '…' : ''}`;
}

function searchDocuments(db, query, filters, options = {}) {
  const docs = documentRows(db, { ...filters, limit: 500 }, options);
  if (!query.trim()) {
    return docs.slice(0, 50).map((doc) => ({ ...doc, score: 0, snippet: snippet(doc.content, '') }));
  }
  const searchItems = docs.map((doc) => ({ ...doc, tagsText: doc.tags.join(' '), metadataText: JSON.stringify(doc.metadata) }));
  const fuse = new Fuse(searchItems, {
    includeScore: true,
    threshold: 0.62,
    ignoreLocation: true,
    minMatchCharLength: 2,
    keys: [
      { name: 'title', weight: 0.42 },
      { name: 'content', weight: 0.28 },
      { name: 'path', weight: 0.12 },
      { name: 'type', weight: 0.05 },
      { name: 'tagsText', weight: 0.08 },
      { name: 'metadataText', weight: 0.05 }
    ]
  });
  const results = fuse.search(query).map(({ item, score }) => {
    const lowerQuery = query.toLocaleLowerCase();
    const titleHit = item.title.toLocaleLowerCase().includes(lowerQuery);
    const contentHit = item.content.toLocaleLowerCase().includes(lowerQuery);
    return {
      ...item,
      score: Math.round((1 - (score ?? 1)) * 100) / 100,
      snippet: snippet(item.content, query),
      _rank: titleHit ? 3 : contentHit ? 2 : 1
    };
  }).sort((a, b) => b._rank - a._rank || b.score - a.score || b.updatedAt.localeCompare(a.updatedAt));
  return results.map(({ _rank, tagsText, metadataText, ...result }) => result).slice(0, 100);
}

function installRoutes(app, db, authDb, environment = process.env) {
  app.get('/api/health', (req, res) => res.json({ ok: true, name: 'NexusData API', timestamp: now() }));
  installAuthRoutes(app, authDb, environment);
  app.use('/api', requireAuth(authDb, environment));

  app.get('/api/stats', (req, res) => {
    const localOnly = isOffline(req);
    const sourceFilter = localOnly ? " WHERE type = 'local'" : '';
    const documentFilter = localOnly ? " WHERE source_id IN (SELECT id FROM sources WHERE type = 'local')" : '';
    const collectionFilter = localOnly ? ` WHERE ${offlineCollectionClause()}` : '';
    const counts = db.get(`SELECT
      (SELECT COUNT(*) FROM documents${documentFilter}) AS documents,
      (SELECT COUNT(*) FROM sources${sourceFilter}) AS sources,
      (SELECT COUNT(*) FROM collections c${collectionFilter}) AS collections,
      (SELECT MAX(last_sync_at) FROM sources${sourceFilter}) AS last_sync_at`);
    const recentWhere = localOnly ? " WHERE s.type = 'local'" : '';
    const recent = db.all(`${documentSelect()}${recentWhere} ORDER BY d.updated_at DESC LIMIT 6`).map((row) => withDocumentShape(db, row));
    res.json({ documents: Number(counts.documents), sources: Number(counts.sources), collections: Number(counts.collections), lastSyncAt: counts.last_sync_at, recent });
  });

  app.get('/api/sources', (req, res) => {
    const where = isOffline(req) ? " WHERE s.type = 'local'" : '';
    const rows = db.all(`SELECT s.*, (SELECT COUNT(*) FROM documents d WHERE d.source_id = s.id) AS document_count FROM sources s${where} ORDER BY s.created_at DESC`);
    res.json(rows.map((row) => sourceForResponse(row)));
  });

  app.post('/api/sources', (req, res) => {
    try {
      const input = validateSourceInput(req.body || {});
      if (isOffline(req) && input.type !== 'local') return res.status(403).json({ error: 'El modo offline solo admite archivos locales.' });
      const id = ID('source');
      const createdAt = now();
      db.run('INSERT INTO sources (id, name, type, config_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, input.name, input.type, JSON.stringify(input.config), 'pending', createdAt);
      res.status(201).json(sourceResponse(db, { id }));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.put('/api/sources/:id', (req, res) => {
    const existing = sourceRow(db, req.params.id, { localOnly: isOffline(req) });
    if (!existing) return res.status(404).json({ error: 'Fuente no encontrada' });
    try {
      const input = validateSourceInput({ ...existing, ...req.body, config: req.body.config }, existing);
      if (isOffline(req) && input.type !== 'local') return res.status(403).json({ error: 'El modo offline solo admite archivos locales.' });
      db.run('UPDATE sources SET name = ?, type = ?, config_json = ?, status = ?, last_error = NULL WHERE id = ?', input.name, input.type, JSON.stringify(input.config), 'pending', req.params.id);
      res.json(sourceResponse(db, existing));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.delete('/api/sources/:id', (req, res) => {
    if (!sourceRow(db, req.params.id, { localOnly: isOffline(req) })) return res.status(404).json({ error: 'Fuente no encontrada' });
    db.run('DELETE FROM sources WHERE id = ?', req.params.id);
    res.status(204).end();
  });

  app.post('/api/sources/:id/test', async (req, res) => {
    const source = sourceRow(db, req.params.id, { localOnly: isOffline(req) });
    if (!source) return res.status(404).json({ error: 'Fuente no encontrada' });
    try {
      if (source.type === 'local') {
        const config = parseJson(source.config_json);
        const accessible = (config.paths || []).filter((value) => fs.existsSync(value));
        return res.json({ ok: accessible.length > 0, paths: accessible.length, totalPaths: (config.paths || []).length });
      }
      res.json(await testRestSource(source));
    } catch (error) {
      setSourceStatus(db, source.id, 'error', error.message);
      res.status(502).json({ ok: false, error: error.message });
    }
  });

  app.post('/api/sources/:id/sync', async (req, res) => {
    const source = sourceRow(db, req.params.id, { localOnly: isOffline(req) });
    if (!source) return res.status(404).json({ error: 'Fuente no encontrada' });
    try {
      res.json(await syncSource(db, source));
    } catch (error) {
      res.status(502).json({ error: error.message, source: error.syncSource });
    }
  });

  app.get('/api/documents', (req, res) => {
    const options = { localOnly: isOffline(req) };
    res.json({ total: documentRows(db, { ...req.query, limit: 500 }, options).length, documents: documentRows(db, { ...req.query, limit: req.query.limit || 200 }, options) });
  });

  app.get('/api/documents/:id', (req, res) => {
    const where = isOffline(req) ? " AND s.type = 'local'" : '';
    const row = db.get(`${documentSelect()} WHERE d.id = ?${where}`, req.params.id);
    if (!row) return res.status(404).json({ error: 'Documento no encontrado' });
    res.json(withDocumentShape(db, row));
  });

  app.put('/api/documents/:id', (req, res) => {
    const where = isOffline(req) ? " AND s.type = 'local'" : '';
    const existing = db.get(`SELECT d.id, d.title FROM documents d JOIN sources s ON s.id = d.source_id WHERE d.id = ?${where}`, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Documento no encontrado' });
    const title = asText(req.body?.title);
    const content = typeof req.body?.content === 'string' ? req.body.content : null;
    if (!title || title.length > 240) return res.status(400).json({ error: 'Indica un título de hasta 240 caracteres' });
    if (content === null || content.length > 1500000) return res.status(400).json({ error: 'El contenido debe ser texto y no superar 1,5 MB' });
    db.run('UPDATE documents SET title = ?, content = ?, updated_at = ? WHERE id = ?', title, content, now(), existing.id);
    const updated = db.get(`${documentSelect()} WHERE d.id = ?${where}`, existing.id);
    res.json(withDocumentShape(db, updated));
  });

  app.get('/api/search', (req, res) => {
    const query = asText(req.query.q);
    const results = searchDocuments(db, query, { source: req.query.source, type: req.query.type, tag: req.query.tag, collection: req.query.collection, updatedFrom: req.query.updatedFrom }, { localOnly: isOffline(req) });
    res.json({ query, total: results.length, results });
  });

  app.get('/api/tags', (req, res) => {
    const from = isOffline(req)
      ? `FROM tags t JOIN document_tags dt ON dt.tag_id = t.id JOIN documents d ON d.id = dt.document_id JOIN sources s ON s.id = d.source_id WHERE s.type = 'local'`
      : 'FROM tags t LEFT JOIN document_tags dt ON dt.tag_id = t.id';
    const tags = db.all(`SELECT t.id, t.name, COUNT(dt.document_id) AS document_count ${from} GROUP BY t.id ORDER BY t.name`);
    res.json(tags.map((tag) => ({ id: tag.id, name: tag.name, documentCount: Number(tag.document_count) })));
  });

  app.post('/api/documents/:id/tags', (req, res) => {
    const where = isOffline(req) ? " AND s.type = 'local'" : '';
    const document = db.get(`SELECT d.id FROM documents d JOIN sources s ON s.id = d.source_id WHERE d.id = ?${where}`, req.params.id);
    if (!document) return res.status(404).json({ error: 'Documento no encontrado' });
    const name = asText(req.body?.name).slice(0, 60);
    if (!name) return res.status(400).json({ error: 'Indica un nombre de etiqueta' });
    db.run('INSERT OR IGNORE INTO tags (id, name) VALUES (?, ?)', ID('tag'), name);
    const tag = db.get('SELECT id, name FROM tags WHERE lower(name) = lower(?)', name);
    db.run('INSERT OR IGNORE INTO document_tags (document_id, tag_id) VALUES (?, ?)', req.params.id, tag.id);
    res.status(201).json({ id: tag.id, name: tag.name });
  });

  app.delete('/api/documents/:id/tags/:tagId', (req, res) => {
    if (isOffline(req)) {
      const document = db.get(`SELECT d.id FROM documents d JOIN sources s ON s.id = d.source_id WHERE d.id = ? AND s.type = 'local'`, req.params.id);
      if (!document) return res.status(404).json({ error: 'Documento no encontrado' });
    }
    db.run('DELETE FROM document_tags WHERE document_id = ? AND tag_id = ?', req.params.id, req.params.tagId);
    res.status(204).end();
  });

  app.get('/api/collections', (req, res) => {
    const localOnly = isOffline(req);
    const itemJoin = localOnly
      ? `LEFT JOIN collection_items ci ON ci.collection_id = c.id
         LEFT JOIN documents d ON d.id = ci.document_id
         LEFT JOIN sources s ON s.id = d.source_id AND s.type = 'local'`
      : 'LEFT JOIN collection_items ci ON ci.collection_id = c.id';
    const itemCount = localOnly ? 'COUNT(s.id)' : 'COUNT(ci.document_id)';
    const where = localOnly ? ` WHERE ${offlineCollectionClause()}` : '';
    const rows = db.all(`SELECT c.*, ${itemCount} AS item_count FROM collections c ${itemJoin}${where} GROUP BY c.id ORDER BY c.created_at DESC`);
    res.json(rows.map((row) => ({ id: row.id, name: row.name, description: row.description, createdAt: row.created_at, itemCount: Number(row.item_count) })));
  });

  app.post('/api/collections', (req, res) => {
    const name = asText(req.body?.name).slice(0, 120);
    const description = asText(req.body?.description).slice(0, 500);
    if (!name) return res.status(400).json({ error: 'Indica un nombre para la colección' });
    const id = ID('collection');
    try {
      db.run('INSERT INTO collections (id, name, description, created_at) VALUES (?, ?, ?, ?)', id, name, description, now());
      res.status(201).json({ id, name, description, itemCount: 0 });
    } catch (error) {
      res.status(409).json({ error: 'Ya existe una colección con ese nombre' });
    }
  });

  app.get('/api/collections/:id', (req, res) => {
    const collectionWhere = isOffline(req) ? ` AND ${offlineCollectionClause()}` : '';
    const collection = db.get(`SELECT * FROM collections c WHERE id = ?${collectionWhere}`, req.params.id);
    if (!collection) return res.status(404).json({ error: 'Colección no encontrada' });
    const itemWhere = isOffline(req) ? " AND s.type = 'local'" : '';
    const items = db.all(`${documentSelect()} JOIN collection_items ci ON ci.document_id = d.id WHERE ci.collection_id = ?${itemWhere} ORDER BY d.updated_at DESC`, req.params.id).map((row) => withDocumentShape(db, row));
    res.json({ id: collection.id, name: collection.name, description: collection.description, createdAt: collection.created_at, itemCount: items.length, items });
  });

  app.post('/api/collections/:id/items', (req, res) => {
    const collectionWhere = isOffline(req) ? ` AND ${offlineCollectionClause()}` : '';
    if (!db.get(`SELECT id FROM collections c WHERE id = ?${collectionWhere}`, req.params.id)) return res.status(404).json({ error: 'Colección no encontrada' });
    const documentId = asText(req.body?.documentId);
    const documentWhere = isOffline(req) ? " AND s.type = 'local'" : '';
    if (!db.get(`SELECT d.id FROM documents d JOIN sources s ON s.id = d.source_id WHERE d.id = ?${documentWhere}`, documentId)) return res.status(404).json({ error: 'Documento no encontrado' });
    db.run('INSERT OR IGNORE INTO collection_items (collection_id, document_id) VALUES (?, ?)', req.params.id, documentId);
    res.status(201).json({ ok: true });
  });

  app.delete('/api/collections/:id/items/:documentId', (req, res) => {
    if (isOffline(req)) {
      const document = db.get(`SELECT d.id FROM documents d JOIN sources s ON s.id = d.source_id WHERE d.id = ? AND s.type = 'local'`, req.params.documentId);
      if (!document) return res.status(404).json({ error: 'Documento no encontrado' });
    }
    db.run('DELETE FROM collection_items WHERE collection_id = ? AND document_id = ?', req.params.id, req.params.documentId);
    res.status(204).end();
  });

  app.delete('/api/collections/:id', (req, res) => {
    const collectionWhere = isOffline(req) ? ` AND ${offlineCollectionClause()}` : '';
    if (!db.get(`SELECT id FROM collections c WHERE id = ?${collectionWhere}`, req.params.id)) return res.status(404).json({ error: 'Colección no encontrada' });
    db.run('DELETE FROM collections WHERE id = ?', req.params.id);
    res.status(204).end();
  });
}

module.exports = { installRoutes, documentRows, searchDocuments, validateSourceInput, syncSource };
