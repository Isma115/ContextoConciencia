const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');
const { startServer } = require('../server/app');

class MemoryAuthStore {
  constructor() { this.user = null; this.available = true; }
  async initialize() { return true; }
  async ensureAvailable() { return true; }
  async close() {}
  async findUserByUsername(username) { return this.user?.usuario === username ? this.user : null; }
  async createUser(username, passwordHash) {
    this.user = { id: 1, usuario: username, password_hash: passwordHash, creado_en: new Date() };
    return this.user;
  }
}

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
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusdata-code-map-api-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'entry.js'), "import { helper } from './helper';\nexport const entry = () => helper();\n");
  fs.writeFileSync(path.join(root, 'src', 'helper.js'), 'export function helper() { return 1; }');
  api = await startServer({
    port: 0,
    dbPath: path.join(root, 'nexusdata.db'),
    authDb: new MemoryAuthStore(),
    environment: { JWT_SECRET: 'code-map-api-test-secret-that-is-long-enough', NODE_ENV: 'test' }
  });
  const registered = await request('/auth/register', { method: 'POST', body: JSON.stringify({ username: 'map.test', password: 'contraseña-segura' }) });
  assert.equal(registered.response.status, 201);
});

test('expone descubrimiento, análisis parcial y apertura segura de código', async () => {
  const empty = await request('/code-map/files');
  assert.equal(empty.response.status, 200);
  assert.equal(empty.body.loaded, false);

  const loaded = await request('/global-project', { method: 'POST', body: JSON.stringify({ path: root, name: 'Mapa API' }) });
  assert.equal(loaded.response.status, 201);

  const files = await request('/code-map/files');
  assert.equal(files.response.status, 200);
  assert.deepEqual(files.body.files.map((file) => file.path), ['src/entry.js', 'src/helper.js']);

  const analysed = await request('/code-map/analyze', { method: 'POST', body: JSON.stringify({ scope: 'entry', entryFile: 'src/entry.js' }) });
  assert.equal(analysed.response.status, 200);
  assert.deepEqual(analysed.body.files.map((file) => file.path), ['src/entry.js', 'src/helper.js']);
  assert.ok(analysed.body.relations.some((relation) => relation.kind === 'imports' && relation.resolved));

  const source = await request('/code-map/file?path=src%2Fentry.js&line=2');
  assert.equal(source.response.status, 200);
  assert.equal(source.body.line, 2);
  assert.match(source.body.content, /helper/);

  const traversal = await request('/code-map/file?path=..%2Foutside.js');
  assert.equal(traversal.response.status, 400);
});

test('admite trabajos asíncronos y cancelación', async () => {
  const queued = await request('/code-map/analyze', { method: 'POST', body: JSON.stringify({ async: true }) });
  assert.equal(queued.response.status, 202);
  assert.ok(queued.body.jobId);
  let status = await request(`/code-map/status/${queued.body.jobId}`);
  for (let attempt = 0; attempt < 20 && !['completed', 'failed', 'cancelled'].includes(status.body.status); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    status = await request(`/code-map/status/${queued.body.jobId}`);
  }
  assert.equal(status.body.status, 'completed');
  assert.equal(status.body.result.summary.files, 2);
});

after(async () => {
  await api.close();
  fs.rmSync(root, { recursive: true, force: true });
});
