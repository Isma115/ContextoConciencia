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
  const response = await fetch(`http://127.0.0.1:${api.port}/api${route}`, {
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...options
  });
  const nextCookie = response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie');
  if (nextCookie) cookie = nextCookie.split(';', 1)[0];
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  return { response, body };
}

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusdata-offline-only-'));
  api = await startServer({
    port: 0,
    dbPath: path.join(root, 'nexusdata.db'),
    environment: { JWT_SECRET: 'offline-only-test-secret-that-is-long-enough', NODE_ENV: 'test' }
  });
});

test('inicia offline por defecto y no habilita autenticación o fuentes REST', async () => {
  assert.equal(api.app.locals.offlineOnly, true);
  assert.equal(api.app.locals.authDb.isAvailable(), false);

  const offline = await request('/auth/offline', { method: 'POST' });
  assert.equal(offline.response.status, 200);
  assert.equal(offline.body.user.offline, true);

  const login = await request('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'usuario', password: 'contraseña-segura' }) });
  assert.equal(login.response.status, 403);

  const rest = await request('/sources', { method: 'POST', body: JSON.stringify({ name: 'No permitida', type: 'rest', config: { url: 'https://example.com', mapping: {} } }) });
  assert.equal(rest.response.status, 403);
});

after(async () => {
  await api.close();
  fs.rmSync(root, { recursive: true, force: true });
});
