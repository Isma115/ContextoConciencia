const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');
const { startServer } = require('../server/app');

let api;
let root;
let cookie = '';

async function request(route, options = {}) {
  const { headers, ...rest } = options;
  const response = await fetch(`http://127.0.0.1:${api.port}/api${route}`, {
    ...rest,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(headers || {}) }
  });
  const nextCookie = response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie');
  if (nextCookie) cookie = nextCookie.split(';', 1)[0];
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  return { response, body };
}

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusdata-recent-'));
  const docsDir = path.join(root, 'docs');
  fs.mkdirSync(docsDir);
  fs.writeFileSync(path.join(docsDir, 'alfa.md'), '# Alfa\n');
  fs.writeFileSync(path.join(docsDir, 'beta.md'), '# Beta\n');
  fs.writeFileSync(path.join(docsDir, 'gamma.md'), '# Gamma\n');
  api = await startServer({
    port: 0,
    dbPath: path.join(root, 'nexusdata.db'),
    environment: { JWT_SECRET: 'recent-test-secret-that-is-long-enough', NODE_ENV: 'test' }
  });
  const offline = await request('/auth/offline', { method: 'POST' });
  assert.equal(offline.response.status, 200);
  const source = await request('/sources', { method: 'POST', body: JSON.stringify({ name: 'Recientes', type: 'local', config: { paths: [docsDir] } }) });
  assert.equal(source.response.status, 201);
  const sync = await request(`/sources/${source.body.id}/sync`, { method: 'POST' });
  assert.equal(sync.response.status, 200);
});

test('sin aperturas previas recientes cae a updated_at', async () => {
  const recent = await request('/documents/recent');
  assert.equal(recent.response.status, 200);
  assert.equal(recent.body.documents.length, 3);
  assert.equal(recent.body.documents[0].lastOpenedAt, null);
});

test('registrar apertura reordena recientes por última vez visto', async () => {
  const { body } = await request('/documents');
  const gamma = body.documents.find((doc) => doc.title === 'gamma');
  const alfa = body.documents.find((doc) => doc.title === 'alfa');
  const opened = await request(`/documents/${gamma.id}/open`, { method: 'POST' });
  assert.equal(opened.response.status, 200);
  assert.ok(opened.body.lastOpenedAt);
  await new Promise((resolve) => setTimeout(resolve, 5));
  await request(`/documents/${alfa.id}/open`, { method: 'POST' });
  const recent = await request('/documents/recent');
  assert.equal(recent.body.documents[0].id, alfa.id);
  assert.equal(recent.body.documents[1].id, gamma.id);
  const missing = await request('/documents/doc_inexistente/open', { method: 'POST' });
  assert.equal(missing.response.status, 404);
});

test('resincronizar conserva last_opened_at', async () => {
  const beforeSync = await request('/documents/recent');
  const sourceId = beforeSync.body.documents[0].sourceId;
  const firstId = beforeSync.body.documents[0].id;
  const firstOpenedAt = beforeSync.body.documents[0].lastOpenedAt;
  const sync = await request(`/sources/${sourceId}/sync`, { method: 'POST' });
  assert.equal(sync.response.status, 200);
  const afterSync = await request('/documents/recent');
  const kept = afterSync.body.documents.find((doc) => doc.id === firstId);
  assert.equal(kept.lastOpenedAt, firstOpenedAt);
  assert.equal(afterSync.body.documents[0].id, firstId);
});

after(async () => {
  await api.close();
  fs.rmSync(root, { recursive: true, force: true });
});
