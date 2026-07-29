const crypto = require('node:crypto');

const MAX_PREVIEW_BYTES = 30 * 1024 * 1024;
const PREVIEW_TTL_MS = 10 * 60 * 1000;
const previews = new Map();

function pruneExpired() {
  const now = Date.now();
  for (const [token, preview] of previews) {
    if (preview.expiresAt <= now) previews.delete(token);
  }
}

function createHtmlPreview(content) {
  pruneExpired();
  if (typeof content !== 'string' || !content.trim()) throw new Error('La previsualización HTML está vacía');
  if (Buffer.byteLength(content, 'utf8') > MAX_PREVIEW_BYTES) {
    throw new Error(`La previsualización supera el límite de ${MAX_PREVIEW_BYTES / 1024 / 1024} MB`);
  }
  const token = crypto.randomUUID();
  previews.set(token, { content, expiresAt: Date.now() + PREVIEW_TTL_MS });
  return token;
}

function getHtmlPreview(token) {
  pruneExpired();
  const preview = previews.get(token);
  return preview?.content || null;
}

module.exports = { createHtmlPreview, getHtmlPreview, MAX_PREVIEW_BYTES, PREVIEW_TTL_MS };
