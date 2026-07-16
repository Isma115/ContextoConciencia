const crypto = require('node:crypto');
const { now } = require('../database/db');

function idFor(value) {
  return crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function upsertDocument(db, sourceId, document) {
  const timestamp = now();
  const existing = db.get(
    'SELECT id, created_at FROM documents WHERE source_id = ? AND external_id = ?',
    sourceId,
    document.externalId
  );
  const id = existing?.id || `doc_${idFor(`${sourceId}:${document.externalId}`)}`;
  db.run(
    `INSERT INTO documents (id, source_id, external_id, title, content, type, path, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(source_id, external_id) DO UPDATE SET
       title = excluded.title, content = excluded.content, type = excluded.type,
       path = excluded.path, metadata_json = excluded.metadata_json, updated_at = excluded.updated_at`,
    id,
    sourceId,
    document.externalId,
    document.title,
    document.content,
    document.type,
    document.path,
    JSON.stringify(document.metadata || {}),
    existing?.created_at || timestamp,
    timestamp
  );
  return { id, updated: Boolean(existing) };
}

module.exports = { upsertDocument };
