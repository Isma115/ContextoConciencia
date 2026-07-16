const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('local', 'rest')),
  config_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  last_sync_at TEXT,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  path TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source_id, external_id)
);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE IF NOT EXISTS document_tags (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY(document_id, tag_id)
);

CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collection_items (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  PRIMARY KEY(collection_id, document_id)
);

CREATE INDEX IF NOT EXISTS idx_documents_source ON documents(source_id);
CREATE INDEX IF NOT EXISTS idx_documents_updated ON documents(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(type);
CREATE INDEX IF NOT EXISTS idx_document_tags_tag ON document_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_collection_items_document ON collection_items(document_id);
`;

function now() {
  return new Date().toISOString();
}

function openDatabase(dbPath) {
  const resolvedPath = dbPath || path.join(process.cwd(), 'data', 'nexusdata.db');
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  const database = new DatabaseSync(resolvedPath);
  database.exec(SCHEMA);

  const api = {
    raw: database,
    path: resolvedPath,
    all(sql, ...params) {
      return database.prepare(sql).all(...params);
    },
    get(sql, ...params) {
      return database.prepare(sql).get(...params);
    },
    run(sql, ...params) {
      return database.prepare(sql).run(...params);
    },
    transaction(callback) {
      database.exec('BEGIN');
      try {
        const result = callback();
        database.exec('COMMIT');
        return result;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
    close() {
      database.close();
    }
  };

  return api;
}

function parseJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function sourceForResponse(row, { revealSecrets = false } = {}) {
  if (!row) return null;
  const config = parseJson(row.config_json);
  const safeConfig = { ...config };
  if (safeConfig.headers && !revealSecrets) {
    safeConfig.headers = Object.fromEntries(
      Object.keys(safeConfig.headers).map((key) => [key, '••••••••'])
    );
    safeConfig.headerNames = Object.keys(config.headers);
  }
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    config: safeConfig,
    status: row.status,
    createdAt: row.created_at,
    lastSyncAt: row.last_sync_at,
    lastError: row.last_error || null,
    documentCount: Number(row.document_count || 0)
  };
}

function documentTags(db, documentId) {
  return db.all(
    `SELECT t.id, t.name FROM tags t
     JOIN document_tags dt ON dt.tag_id = t.id
     WHERE dt.document_id = ? ORDER BY t.name`,
    documentId
  );
}

function withDocumentShape(db, row) {
  if (!row) return null;
  return {
    id: row.id,
    sourceId: row.source_id,
    source: row.source_name,
    externalId: row.external_id,
    title: row.title,
    content: row.content,
    type: row.type,
    path: row.path,
    metadata: parseJson(row.metadata_json),
    tags: documentTags(db, row.id).map((tag) => tag.name),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function documentSelect() {
  return `SELECT d.*, s.name AS source_name
          FROM documents d JOIN sources s ON s.id = d.source_id`;
}

module.exports = {
  openDatabase,
  now,
  parseJson,
  sourceForResponse,
  documentTags,
  withDocumentShape,
  documentSelect
};
