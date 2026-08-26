const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { test, before, after } = require('node:test');
const { startServer } = require('../server/app');

let api;
let fixtureDir;
let externalServer;
let sessionCookie = '';
let authStore;

class MemoryAuthStore {
  constructor() { this.users = new Map(); this.nextId = 1; this.available = false; }
  async initialize() { this.available = true; return true; }
  isAvailable() { return this.available; }
  async ensureAvailable() { return this.available || this.initialize(); }
  async close() { this.available = false; }
  async findUserByUsername(username) { return this.users.get(username) || null; }
  async createUser(username, passwordHash) {
    if (this.users.has(username)) { const error = new Error('duplicado'); error.code = 'ER_DUP_ENTRY'; throw error; }
    const user = { id: this.nextId++, usuario: username, password_hash: passwordHash, creado_en: new Date() };
    this.users.set(username, user);
    return user;
  }
}

async function request(route, options = {}, { expectedStatus = null } = {}) {
  const response = await fetch(`http://127.0.0.1:${api.port}/api${route}`, { headers: { 'Content-Type': 'application/json', ...(sessionCookie ? { Cookie: sessionCookie } : {}), ...(options.headers || {}) }, ...options });
  const cookie = response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie');
  if (cookie) sessionCookie = cookie.split(';', 1)[0];
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (expectedStatus !== null) {
    assert.equal(response.status, expectedStatus, `${options.method || 'GET'} ${route}: ${JSON.stringify(body)}`);
    return body;
  }
  assert.ok(response.ok, `${options.method || 'GET'} ${route}: ${response.status} ${JSON.stringify(body)}`);
  return body;
}

before(async () => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusdata-'));
  fs.writeFileSync(path.join(fixtureDir, 'README.md'), '# Authentication service\nConfiguration and deployment notes.');
  fs.writeFileSync(path.join(fixtureDir, 'config.json'), JSON.stringify({ DATABASE_URL: 'sqlite://local', service: 'auth-service' }));
  fs.writeFileSync(path.join(fixtureDir, 'routes.csv'), 'method,path\nGET,/health\n');
  fs.writeFileSync(path.join(fixtureDir, 'registro-de-usuario.nxd'), 'diagram "Registro de usuario"\nnode inicio "Inicio" start');
  externalServer = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data: [{ id: 1, title: 'Remote incident', description: 'API response from REST source' }] }));
  });
  await new Promise((resolve) => externalServer.listen(0, '127.0.0.1', resolve));
  authStore = new MemoryAuthStore();
  api = await startServer({
    port: 0,
    dbPath: path.join(fixtureDir, 'test.db'),
    authDb: authStore,
    environment: { JWT_SECRET: 'test-secret-that-is-long-enough-for-jwt-signing', SESSION_DURATION: '8h', NODE_ENV: 'test' }
  });
});

test('registra, normaliza, autentica y cierra sesión sin guardar texto plano', async () => {
  const registered = await request('/auth/register', { method: 'POST', body: JSON.stringify({ username: '  Ada.Admin ', password: 'contraseña-muy-segura' }) });
  assert.equal(registered.user.username, 'ada.admin');
  assert.equal(registered.user.id, 1);
  assert.match(sessionCookie, /^nexusdata_session=/);
  assert.notEqual(authStore.users.get('ada.admin').password_hash, 'contraseña-muy-segura');
  assert.match(authStore.users.get('ada.admin').password_hash, /^\$2[aby]\$12\$/);
  await request('/auth/register', { method: 'POST', body: JSON.stringify({ username: 'beatriz', password: 'contraseña-muy-segura' }) });
  assert.notEqual(authStore.users.get('ada.admin').password_hash, authStore.users.get('beatriz').password_hash);
  const me = await request('/auth/me');
  assert.equal(me.user.username, 'beatriz');
  await request('/auth/register', { method: 'POST', body: JSON.stringify({ username: 'ADA.ADMIN', password: 'otra-contraseña-segura' }) }, { expectedStatus: 409 });
  await request('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'ada.admin', password: 'contraseña-incorrecta' }) }, { expectedStatus: 401 });
  await request('/auth/logout', { method: 'POST' });
  await request('/auth/me', {}, { expectedStatus: 401 });
  await request('/auth/login', { method: 'POST', body: JSON.stringify({ username: 'ADA.ADMIN', password: 'contraseña-muy-segura' }) });
});

test('rechaza las rutas de datos sin sesión', async () => {
  const saved = sessionCookie;
  sessionCookie = '';
  await request('/documents', {}, { expectedStatus: 401 });
  sessionCookie = saved;
});

after(async () => {
  await api.close();
  await new Promise((resolve) => externalServer.close(resolve));
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});

test('importa fuentes locales y conserva el origen', async () => {
  const source = await request('/sources', { method: 'POST', body: JSON.stringify({ name: 'Fixtures locales', type: 'local', config: { paths: [fixtureDir] } }) });
  const synced = await request(`/sources/${source.id}/sync`, { method: 'POST' });
  assert.equal(synced.total, 4);
  const docs = await request('/documents');
  assert.equal(docs.total, 4);
  assert.ok(docs.documents.every((doc) => doc.source === 'Fixtures locales'));
  assert.ok(docs.documents.some((doc) => doc.path.endsWith('README.md')));
  const diagram = docs.documents.find((doc) => doc.path.endsWith('registro-de-usuario.nxd'));
  assert.equal(diagram.type, 'diagram');
  assert.match(diagram.content, /diagram "Registro de usuario"/);
  const readme = docs.documents.find((doc) => doc.path.endsWith('README.md'));
  const detail = await request(`/documents/${readme.id}`);
  assert.equal(detail.id, readme.id);
  assert.match(detail.content, /Authentication service/);

  const orderBeforeSync = (await request('/search?q=')).results
    .filter((document) => document.sourceId === source.id)
    .map((document) => document.id);
  await request(`/sources/${source.id}/sync`, { method: 'POST' });
  const orderAfterSync = (await request('/search?q=')).results
    .filter((document) => document.sourceId === source.id)
    .map((document) => document.id);
  assert.deepEqual(orderAfterSync, orderBeforeSync);
});

test('carga un proyecto global y poda recursos que ya no existen', async () => {
  const projectDir = path.join(fixtureDir, 'proyecto-global');
  fs.mkdirSync(projectDir);
  fs.writeFileSync(path.join(projectDir, 'index.html'), '<h1>Proyecto global</h1>');
  fs.writeFileSync(path.join(projectDir, 'styles.css'), 'h1 { color: red; }');
  fs.writeFileSync(path.join(projectDir, 'app.js'), 'document.body.dataset.ready = "yes";');

  const loaded = await request('/global-project', { method: 'POST', body: JSON.stringify({ path: projectDir, name: 'Proyecto global' }) });
  assert.equal(loaded.loaded, true);
  assert.equal(loaded.project.name, 'Proyecto global');
  assert.equal(loaded.sync.total, 1);
  assert.equal(loaded.project.source.documentCount, 1);

  fs.writeFileSync(path.join(projectDir, 'notes.md'), '# Notas del proyecto');
  const synced = await request(`/sources/${loaded.project.id}/sync`, { method: 'POST' });
  assert.equal(synced.source.documentCount, 2);
  const globalProject = await request('/global-project');
  assert.equal(globalProject.project.source.documentCount, 2);
  await request('/global-project', { method: 'DELETE' }, { expectedStatus: 204 });
  assert.equal((await request('/global-project')).loaded, false);
});

test('guarda las fuentes del visor HTML y permite recuperarlas desde el buscador', async () => {
  const htmlDir = path.join(fixtureDir, 'visor-html');
  fs.mkdirSync(htmlDir);
  fs.writeFileSync(path.join(htmlDir, 'index.html'), '<!doctype html><h1>Visor persistente</h1>');
  fs.writeFileSync(path.join(htmlDir, 'styles.css'), 'h1 { color: red; }');
  fs.writeFileSync(path.join(htmlDir, 'app.js'), 'document.body.dataset.ready = "yes";');

  const payload = { name: 'Visor persistente', paths: [htmlDir] };
  const saved = await request('/html-viewer/sources', { method: 'POST', body: JSON.stringify(payload) });
  assert.equal(saved.source.config.role, 'html-viewer');
  assert.equal(saved.project.entry, 'index.html');
  assert.equal(saved.sync.total, 1);

  const sameSource = await request('/html-viewer/sources', { method: 'POST', body: JSON.stringify(payload) });
  assert.equal(sameSource.source.id, saved.source.id);

  const results = await request('/search?q=Visor%20persistente');
  const htmlDocument = results.results.find((document) => document.sourceId === saved.source.id);
  assert.ok(htmlDocument);

  const reopened = await request(`/html-viewer/sources/${saved.source.id}/project`);
  assert.equal(reopened.source.id, saved.source.id);
  assert.equal(reopened.project.entry, 'index.html');
});

test('edita y persiste documentos', async () => {
  const docs = await request('/documents');
  const readme = docs.documents.find((doc) => doc.path.endsWith('README.md'));
  const updated = await request(`/documents/${readme.id}`, {
    method: 'PUT',
    body: JSON.stringify({ title: 'README editado', content: '# Authentication service\nConfiguration actualizada.' })
  });
  assert.equal(updated.title, 'README editado');
  assert.match(updated.content, /actualizada/);
  const reloaded = await request(`/documents/${readme.id}`);
  assert.equal(reloaded.title, 'README editado');
  assert.equal(reloaded.content, '# Authentication service\nConfiguration actualizada.');
});

test('busca coincidencias aproximadas y filtra por tipo', async () => {
  const result = await request('/search?q=configruation&type=markdown');
  assert.ok(result.total >= 1);
  assert.match(result.results[0].content, /Configuration/);
  const exact = await request('/search?q=DATABASE_URL');
  assert.ok(exact.results.some((doc) => doc.type === 'json'));
});

test('etiqueta documentos y los organiza en colecciones', async () => {
  const docs = await request('/documents');
  const documentId = docs.documents[0].id;
  const tag = await request(`/documents/${documentId}/tags`, { method: 'POST', body: JSON.stringify({ name: 'backend' }) });
  assert.equal(tag.name, 'backend');
  const collection = await request('/collections', { method: 'POST', body: JSON.stringify({ name: 'Proyecto Alpha', description: 'Contexto principal' }) });
  await request(`/collections/${collection.id}/items`, { method: 'POST', body: JSON.stringify({ documentId }) });
  const detail = await request(`/collections/${collection.id}`);
  assert.equal(detail.itemCount, 1);
  assert.ok(detail.items[0].tags.includes('backend'));
});

test('conecta y sincroniza una API REST con mapeo', async () => {
  const address = externalServer.address();
  const source = await request('/sources', { method: 'POST', body: JSON.stringify({
    name: 'Incidencias API', type: 'rest', config: {
      url: `http://127.0.0.1:${address.port}/issues`, headers: { Authorization: 'Bearer secret' }, mapping: { id: 'id', title: 'title', content: 'description' }
    }
  }) });
  const visible = (await request('/sources')).find((item) => item.id === source.id);
  assert.equal(visible.config.headers.Authorization, '••••••••');
  const tested = await request(`/sources/${source.id}/test`, { method: 'POST' });
  assert.equal(tested.ok, true);
  const synced = await request(`/sources/${source.id}/sync`, { method: 'POST' });
  assert.equal(synced.total, 1);
  const search = await request('/search?q=Remote+incident');
  assert.ok(search.results.some((doc) => doc.source === 'Incidencias API'));
});

test('permite entrar offline y restringe el contenido a fuentes locales', async () => {
  const remoteSource = (await request('/sources')).find((source) => source.type === 'rest');
  const remoteDocument = (await request('/documents')).documents.find((document) => document.sourceId === remoteSource.id);
  sessionCookie = '';

  const offline = await request('/auth/offline', { method: 'POST' });
  assert.equal(offline.user.offline, true);
  assert.equal(offline.user.username, 'Modo offline');
  const me = await request('/auth/me');
  assert.equal(me.user.offline, true);

  authStore.available = false;
  const sources = await request('/sources');
  assert.ok(sources.length > 0);
  assert.ok(sources.every((source) => source.type === 'local'));
  const documents = await request('/documents');
  assert.ok(documents.documents.every((document) => document.sourceId !== remoteSource.id));
  const search = await request('/search?q=Remote+incident');
  assert.ok(search.results.every((document) => document.sourceId !== remoteSource.id));
  await request(`/documents/${remoteDocument.id}`, {}, { expectedStatus: 404 });
  await request('/sources', {
    method: 'POST',
    body: JSON.stringify({ name: 'No permitida', type: 'rest', config: { url: 'https://example.com', mapping: {} } })
  }, { expectedStatus: 403 });
});
