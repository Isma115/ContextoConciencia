const Fuse = require('fuse.js');
const { withDocumentShape, documentSelect } = require('../../database/db');
const { COMMON_PATHS_ROLE } = require('../common-paths');

function localDocumentClause(localOnly) {
  return localOnly ? "s.type = 'local'" : '';
}

function documentRows(db, query = {}, { localOnly = false, includeCommonPaths = true } = {}) {
  const clauses = [];
  const params = [];
  if (localOnly) clauses.push(localDocumentClause(true));
  if (!includeCommonPaths) clauses.push(`s.config_json NOT LIKE '%"role":"${COMMON_PATHS_ROLE}"%'`);
  if (query.source) {
    clauses.push('d.source_id = ?');
    params.push(query.source);
  }
  if (query.type && query.type !== 'any') {
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
  const rows = db.all(`${documentSelect()}${where} ORDER BY LOWER(COALESCE(d.path, d.title)) ASC, LOWER(d.title) ASC, d.id ASC LIMIT ${limit}`, ...params);
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

function compareStableDocuments(first, second) {
  const firstKey = `${first.path || first.title}\u0000${first.title}\u0000${first.id}`.toLocaleLowerCase();
  const secondKey = `${second.path || second.title}\u0000${second.title}\u0000${second.id}`.toLocaleLowerCase();
  return firstKey.localeCompare(secondKey);
}

function searchDocuments(db, query = '', filters = {}, options = {}) {
  const searchQuery = String(query || '').trim();
  const docs = documentRows(db, { ...filters, limit: 500 }, options);
  if (!searchQuery) {
    return docs.slice(0, 50).map((doc) => ({ ...doc, score: 0, snippet: snippet(doc.content, '') }));
  }
  const searchItems = docs.map((doc) => {
    const titleOnly = doc.metadata?.searchTitleOnly === true;
    return {
      ...doc,
      searchableContent: titleOnly ? '' : doc.content,
      searchablePath: titleOnly ? '' : doc.path,
      searchableType: titleOnly ? '' : doc.type,
      tagsText: titleOnly ? '' : doc.tags.join(' '),
      metadataText: titleOnly ? '' : JSON.stringify(doc.metadata)
    };
  });
  const fuse = new Fuse(searchItems, {
    includeScore: true,
    threshold: 0.62,
    ignoreLocation: true,
    minMatchCharLength: 2,
    keys: [
      { name: 'title', weight: 0.42 },
      { name: 'searchableContent', weight: 0.28 },
      { name: 'searchablePath', weight: 0.12 },
      { name: 'searchableType', weight: 0.05 },
      { name: 'tagsText', weight: 0.08 },
      { name: 'metadataText', weight: 0.05 }
    ]
  });
  const results = fuse.search(searchQuery).map(({ item, score }) => {
    const lowerQuery = searchQuery.toLocaleLowerCase();
    const titleHit = item.title.toLocaleLowerCase().includes(lowerQuery);
    const contentHit = item.content.toLocaleLowerCase().includes(lowerQuery);
    return {
      ...item,
      score: Math.round((1 - (score ?? 1)) * 100) / 100,
      snippet: snippet(item.content, searchQuery),
      _rank: titleHit ? 3 : contentHit ? 2 : 1
    };
  }).sort((a, b) => b._rank - a._rank || b.score - a.score || compareStableDocuments(a, b));
  return results.map(({ _rank, tagsText, metadataText, searchableContent, searchablePath, searchableType, ...result }) => result).slice(0, 100);
}

module.exports = { documentRows, searchDocuments };
