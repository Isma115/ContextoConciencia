const crypto = require('node:crypto');
const { now, parseJson } = require('../database/db');

const WORKSPACE_FORMAT = 'nexusdata-workspace';
const WORKSPACE_VERSION = 1;
const MAX_ID_LENGTH = 240;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJson(value, fallback = {}) {
  if (!isRecord(value)) return fallback;
  return JSON.parse(JSON.stringify(value));
}

function stringValue(value, fallback = '', maxLength = 2000) {
  if (typeof value !== 'string') return fallback;
  return value.slice(0, maxLength);
}

function requiredString(value, label, maxLength = 2000) {
  const result = stringValue(value).trim();
  if (!result) throw new Error(`${label} no es válido`);
  if (result.length > maxLength) throw new Error(`${label} es demasiado largo`);
  return result;
}

function workspaceId(value, prefix) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result) return `${prefix}_${crypto.randomUUID()}`;
  if (result.length > MAX_ID_LENGTH) throw new Error('Un identificador del espacio de trabajo es demasiado largo');
  return result;
}

function timestampValue(value) {
  return typeof value === 'string' && value.trim() ? value.slice(0, 80) : now();
}

function nullableString(value, maxLength = 4000) {
  return typeof value === 'string' && value.trim() ? value.slice(0, maxLength) : null;
}

function sourceForExport(row) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    config: parseJson(row.config_json),
    status: row.status,
    createdAt: row.created_at,
    lastSyncAt: row.last_sync_at || null,
    lastError: row.last_error || null
  };
}

function documentForExport(row) {
  return {
    id: row.id,
    sourceId: row.source_id,
    externalId: row.external_id,
    title: row.title,
    content: row.content,
    type: row.type,
    path: row.path,
    metadata: parseJson(row.metadata_json),
    favorite: Number(row.is_favorite) === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function createWorkspaceSnapshot(db) {
  const sourceRows = db.all('SELECT * FROM sources ORDER BY created_at ASC, id ASC');
  const documentRows = db.all('SELECT * FROM documents ORDER BY created_at ASC, id ASC');
  return {
    format: WORKSPACE_FORMAT,
    version: WORKSPACE_VERSION,
    exportedAt: now(),
    data: {
      sources: sourceRows.map(sourceForExport),
      documents: documentRows.map(documentForExport),
      tags: db.all('SELECT id, name FROM tags ORDER BY name ASC, id ASC'),
      documentTags: db.all('SELECT document_id AS documentId, tag_id AS tagId FROM document_tags ORDER BY document_id ASC, tag_id ASC'),
      collections: db.all('SELECT id, name, description, created_at AS createdAt FROM collections ORDER BY created_at ASC, id ASC'),
      collectionItems: db.all('SELECT collection_id AS collectionId, document_id AS documentId FROM collection_items ORDER BY collection_id ASC, document_id ASC')
    }
  };
}

function normaliseSnapshot(snapshot) {
  if (!isRecord(snapshot)) throw new Error('El archivo del espacio de trabajo no es válido');
  if (snapshot.format !== WORKSPACE_FORMAT) throw new Error('El formato del espacio de trabajo no es compatible');
  if (Number(snapshot.version) !== WORKSPACE_VERSION) throw new Error('La versión del espacio de trabajo no es compatible');
  if (!isRecord(snapshot.data)) throw new Error('El archivo no contiene datos del espacio de trabajo');

  const data = snapshot.data;
  const sourceIds = new Set();
  const sources = (Array.isArray(data.sources) ? data.sources : []).map((item, index) => {
    if (!isRecord(item)) throw new Error(`La fuente ${index + 1} no es válida`);
    const id = workspaceId(item.id, 'source');
    if (sourceIds.has(id)) throw new Error('Hay identificadores de fuente repetidos');
    sourceIds.add(id);
    const type = item.type === 'rest' ? 'rest' : item.type === 'local' ? 'local' : '';
    if (!type) throw new Error(`El tipo de la fuente ${index + 1} no es válido`);
    const status = ['pending', 'ready', 'error'].includes(item.status) ? item.status : 'ready';
    return {
      id,
      name: requiredString(item.name, `El nombre de la fuente ${index + 1}`, 120),
      type,
      config: cloneJson(item.config),
      status,
      createdAt: timestampValue(item.createdAt),
      lastSyncAt: nullableString(item.lastSyncAt, 80),
      lastError: nullableString(item.lastError, 1000)
    };
  });

  const documentIds = new Set();
  const documents = (Array.isArray(data.documents) ? data.documents : []).map((item, index) => {
    if (!isRecord(item)) throw new Error(`El documento ${index + 1} no es válido`);
    const id = workspaceId(item.id, 'doc');
    if (documentIds.has(id)) throw new Error('Hay identificadores de documento repetidos');
    documentIds.add(id);
    const sourceId = requiredString(item.sourceId, `La fuente del documento ${index + 1}`, MAX_ID_LENGTH);
    if (!sourceIds.has(sourceId)) throw new Error(`El documento ${index + 1} apunta a una fuente inexistente`);
    if (typeof item.content !== 'string') throw new Error(`El contenido del documento ${index + 1} no es válido`);
    return {
      id,
      sourceId,
      externalId: requiredString(item.externalId, `El identificador externo del documento ${index + 1}`),
      title: requiredString(item.title, `El título del documento ${index + 1}`, 500),
      content: item.content,
      type: requiredString(item.type, `El tipo del documento ${index + 1}`, 80),
      path: nullableString(item.path),
      metadata: cloneJson(item.metadata),
      favorite: item.favorite === true,
      createdAt: timestampValue(item.createdAt),
      updatedAt: timestampValue(item.updatedAt)
    };
  });

  const tagIds = new Set();
  const tagNames = new Set();
  const tags = (Array.isArray(data.tags) ? data.tags : []).map((item, index) => {
    if (!isRecord(item)) throw new Error(`La etiqueta ${index + 1} no es válida`);
    const id = workspaceId(item.id, 'tag');
    const name = requiredString(item.name, `El nombre de la etiqueta ${index + 1}`, 60);
    const nameKey = name.toLocaleLowerCase();
    if (tagIds.has(id) || tagNames.has(nameKey)) throw new Error('Hay etiquetas repetidas');
    tagIds.add(id);
    tagNames.add(nameKey);
    return { id, name };
  });

  const collectionIds = new Set();
  const collectionNames = new Set();
  const collections = (Array.isArray(data.collections) ? data.collections : []).map((item, index) => {
    if (!isRecord(item)) throw new Error(`La colección ${index + 1} no es válida`);
    const id = workspaceId(item.id, 'collection');
    const name = requiredString(item.name, `El nombre de la colección ${index + 1}`, 120);
    const nameKey = name.toLocaleLowerCase();
    if (collectionIds.has(id) || collectionNames.has(nameKey)) throw new Error('Hay colecciones repetidas');
    collectionIds.add(id);
    collectionNames.add(nameKey);
    return {
      id,
      name,
      description: stringValue(item.description, '', 500),
      createdAt: timestampValue(item.createdAt)
    };
  });

  const documentTagKeys = new Set();
  const documentTags = (Array.isArray(data.documentTags) ? data.documentTags : []).map((item, index) => {
    if (!isRecord(item)) throw new Error(`La relación de etiqueta ${index + 1} no es válida`);
    const documentId = requiredString(item.documentId, 'El documento de una relación de etiqueta', MAX_ID_LENGTH);
    const tagId = requiredString(item.tagId, 'La etiqueta de una relación de etiqueta', MAX_ID_LENGTH);
    if (!documentIds.has(documentId) || !tagIds.has(tagId)) throw new Error('Una relación de etiqueta apunta a un elemento inexistente');
    const key = `${documentId}\u0000${tagId}`;
    if (documentTagKeys.has(key)) throw new Error('Hay relaciones de etiquetas repetidas');
    documentTagKeys.add(key);
    return { documentId, tagId };
  });

  const collectionItemKeys = new Set();
  const collectionItems = (Array.isArray(data.collectionItems) ? data.collectionItems : []).map((item, index) => {
    if (!isRecord(item)) throw new Error(`El elemento de colección ${index + 1} no es válido`);
    const collectionId = requiredString(item.collectionId, 'La colección de un elemento', MAX_ID_LENGTH);
    const documentId = requiredString(item.documentId, 'El documento de un elemento de colección', MAX_ID_LENGTH);
    if (!collectionIds.has(collectionId) || !documentIds.has(documentId)) throw new Error('Un elemento de colección apunta a un elemento inexistente');
    const key = `${collectionId}\u0000${documentId}`;
    if (collectionItemKeys.has(key)) throw new Error('Hay elementos de colección repetidos');
    collectionItemKeys.add(key);
    return { collectionId, documentId };
  });

  return { sources, documents, tags, documentTags, collections, collectionItems };
}

function clearWorkspace(db) {
  db.run('DELETE FROM document_tags');
  db.run('DELETE FROM collection_items');
  db.run('DELETE FROM documents');
  db.run('DELETE FROM sources');
  db.run('DELETE FROM tags');
  db.run('DELETE FROM collections');
}

function upsertSource(db, source) {
  const existing = db.get('SELECT id FROM sources WHERE id = ?', source.id);
  db.run(
    `INSERT INTO sources (id, name, type, config_json, status, created_at, last_sync_at, last_error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, type = excluded.type, config_json = excluded.config_json,
       status = excluded.status, created_at = excluded.created_at,
       last_sync_at = excluded.last_sync_at, last_error = excluded.last_error`,
    source.id,
    source.name,
    source.type,
    JSON.stringify(source.config),
    source.status,
    source.createdAt,
    source.lastSyncAt,
    source.lastError
  );
  return { id: source.id, created: !existing };
}

function upsertDocument(db, document, sourceId) {
  const existingByKey = db.get(
    'SELECT id, created_at, content, metadata_json FROM documents WHERE source_id = ? AND external_id = ?',
    sourceId,
    document.externalId
  );
  const existingById = db.get('SELECT id, source_id, external_id FROM documents WHERE id = ?', document.id);
  const id = existingByKey?.id || (existingById && existingById.source_id === sourceId && existingById.external_id === document.externalId)
    ? (existingByKey?.id || existingById.id)
    : existingById ? `doc_${crypto.randomUUID()}` : document.id;
  let content = document.content;
  let metadata = document.metadata;
  const currentMetadata = parseJson(existingByKey?.metadata_json);
  if (existingByKey && metadata.contentDeferred === true && currentMetadata.contentDeferred !== true) {
    content = existingByKey.content;
    metadata = currentMetadata;
  }
  db.run(
    `INSERT INTO documents (id, source_id, external_id, title, content, type, path, metadata_json, is_favorite, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       source_id = excluded.source_id, external_id = excluded.external_id, title = excluded.title,
       content = excluded.content, type = excluded.type, path = excluded.path,
       metadata_json = excluded.metadata_json, is_favorite = excluded.is_favorite,
       created_at = excluded.created_at, updated_at = excluded.updated_at`,
    id,
    sourceId,
    document.externalId,
    document.title,
    content,
    document.type,
    document.path,
    JSON.stringify(metadata),
    document.favorite ? 1 : 0,
    existingByKey?.created_at || document.createdAt,
    document.updatedAt
  );
  return { id, created: !existingByKey && !existingById };
}

function upsertTag(db, tag) {
  const existingByName = db.get('SELECT id FROM tags WHERE lower(name) = lower(?)', tag.name);
  if (existingByName) return { id: existingByName.id, created: false };
  const existingById = db.get('SELECT id FROM tags WHERE id = ?', tag.id);
  const id = existingById ? `tag_${crypto.randomUUID()}` : tag.id;
  db.run('INSERT INTO tags (id, name) VALUES (?, ?)', id, tag.name);
  return { id, created: true };
}

function upsertCollection(db, collection) {
  const existingByName = db.get('SELECT id FROM collections WHERE lower(name) = lower(?)', collection.name);
  if (existingByName) {
    db.run('UPDATE collections SET description = ? WHERE id = ?', collection.description, existingByName.id);
    return { id: existingByName.id, created: false };
  }
  const existingById = db.get('SELECT id FROM collections WHERE id = ?', collection.id);
  const id = existingById ? `collection_${crypto.randomUUID()}` : collection.id;
  db.run('INSERT INTO collections (id, name, description, created_at) VALUES (?, ?, ?, ?)', id, collection.name, collection.description, collection.createdAt);
  return { id, created: true };
}

function importWorkspaceSnapshot(db, snapshot, { mode = 'merge' } = {}) {
  if (!['merge', 'replace'].includes(mode)) throw new Error('El modo de importación no es válido');
  const data = normaliseSnapshot(snapshot);
  const result = {
    mode,
    sources: { created: 0, updated: 0 },
    documents: { created: 0, updated: 0 },
    tags: { created: 0, existing: 0 },
    collections: { created: 0, existing: 0 },
    relationships: { documentTags: 0, collectionItems: 0 }
  };

  db.transaction(() => {
    if (mode === 'replace') clearWorkspace(db);
    const sourceMap = new Map();
    data.sources.forEach((source) => {
      const imported = upsertSource(db, source);
      sourceMap.set(source.id, imported.id);
      if (imported.created) result.sources.created += 1;
      else result.sources.updated += 1;
    });

    const documentMap = new Map();
    data.documents.forEach((document) => {
      const imported = upsertDocument(db, document, sourceMap.get(document.sourceId));
      documentMap.set(document.id, imported.id);
      if (imported.created) result.documents.created += 1;
      else result.documents.updated += 1;
    });

    const tagMap = new Map();
    data.tags.forEach((tag) => {
      const imported = upsertTag(db, tag);
      tagMap.set(tag.id, imported.id);
      if (imported.created) result.tags.created += 1;
      else result.tags.existing += 1;
    });

    const collectionMap = new Map();
    data.collections.forEach((collection) => {
      const imported = upsertCollection(db, collection);
      collectionMap.set(collection.id, imported.id);
      if (imported.created) result.collections.created += 1;
      else result.collections.existing += 1;
    });

    data.documentTags.forEach(({ documentId, tagId }) => {
      const inserted = db.run('INSERT OR IGNORE INTO document_tags (document_id, tag_id) VALUES (?, ?)', documentMap.get(documentId), tagMap.get(tagId));
      result.relationships.documentTags += Number(inserted.changes || 0);
    });
    data.collectionItems.forEach(({ collectionId, documentId }) => {
      const inserted = db.run('INSERT OR IGNORE INTO collection_items (collection_id, document_id) VALUES (?, ?)', collectionMap.get(collectionId), documentMap.get(documentId));
      result.relationships.collectionItems += Number(inserted.changes || 0);
    });
  });

  return result;
}

module.exports = {
  WORKSPACE_FORMAT,
  WORKSPACE_VERSION,
  createWorkspaceSnapshot,
  importWorkspaceSnapshot,
  normaliseSnapshot
};
