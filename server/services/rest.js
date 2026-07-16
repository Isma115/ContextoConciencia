const { parseJson } = require('../database/db');
const { upsertDocument } = require('./documents');

function validateUrl(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('La URL debe utilizar http o https');
  }
  return url;
}

function valueAt(object, selector) {
  if (!selector) return undefined;
  return selector.split('.').reduce((value, key) => value == null ? undefined : value[key], object);
}

function stringifyValue(value) {
  if (value == null) return '';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function responseItems(payload) {
  if (Array.isArray(payload)) return payload;
  for (const key of ['data', 'results', 'items', 'issues']) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [payload];
}

async function fetchRest(config, { timeoutMs = 15000 } = {}) {
  const url = validateUrl(config.url);
  const headers = {};
  for (const [key, value] of Object.entries(config.headers || {})) {
    if (value != null && String(value).trim()) headers[key] = String(value);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { method: 'GET', headers, signal: controller.signal });
    const raw = await response.text();
    let payload;
    try {
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      payload = { response: raw };
    }
    if (!response.ok) {
      throw new Error(`La API respondió ${response.status} ${response.statusText}`);
    }
    return { response, payload, items: responseItems(payload) };
  } finally {
    clearTimeout(timeout);
  }
}

async function testRestSource(source) {
  const config = parseJson(source.config_json);
  const result = await fetchRest(config, { timeoutMs: 10000 });
  return {
    ok: true,
    status: result.response.status,
    statusText: result.response.statusText,
    items: result.items.length
  };
}

async function syncRestSource(db, source) {
  const config = parseJson(source.config_json);
  const mapping = config.mapping || {};
  const result = await fetchRest(config);
  let created = 0;
  let updated = 0;
  db.transaction(() => {
    result.items.forEach((item, index) => {
      const mappedId = valueAt(item, mapping.id) ?? item.id ?? item.key ?? index;
      const title = stringifyValue(valueAt(item, mapping.title) ?? item.title ?? item.name ?? `Elemento ${index + 1}`);
      const content = stringifyValue(valueAt(item, mapping.content) ?? item.description ?? item.body ?? item);
      const document = {
        externalId: `${config.url}:${String(mappedId)}`,
        title: title.slice(0, 500),
        content,
        type: 'rest',
        path: config.url,
        metadata: {
          sourceUrl: config.url,
          remoteId: mappedId,
          payload: item
        }
      };
      const upserted = upsertDocument(db, source.id, document);
      if (upserted.updated) updated += 1;
      else created += 1;
    });
  });
  return { created, updated, total: created + updated, items: result.items.length, errors: [] };
}

module.exports = { validateUrl, valueAt, responseItems, fetchRest, testRestSource, syncRestSource };
