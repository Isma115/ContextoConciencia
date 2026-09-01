const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');
const { startServer } = require('../server/app');
const { parseSddSpecsMarkdown, sddSpecsToMarkdown } = require('../server/routes/sdd');

let api;
let fixtureDir;
let sessionCookie = '';

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

async function request(route, options = {}) {
  const response = await fetch(`http://127.0.0.1:${api.port}/api${route}`, { headers: { 'Content-Type': 'application/json', ...(sessionCookie ? { Cookie: sessionCookie } : {}), ...(options.headers || {}) }, ...options });
  const cookie = response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie');
  if (cookie) sessionCookie = cookie.split(';', 1)[0];
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  return { status: response.status, ok: response.ok, body };
}

test('parsea encabezados de specs.md con estado, prioridad y categoría', () => {
  const specs = parseSddSpecsMarkdown(`# Specs

Introducción del documento, se ignora antes del primer encabezado.

## El usuario puede buscar documentos
**Estado:** activa
**Prioridad:** alta
**Categoría:** Búsqueda

Permite buscar documentos por título y contenido.

## Exportar diagrama
**Estado:** implementada
**Prioridad:** baja

El usuario puede exportar el diagrama como PNG.
`);
  assert.equal(specs.length, 2);
  assert.equal(specs[0].title, 'El usuario puede buscar documentos');
  assert.equal(specs[0].status, 'active');
  assert.equal(specs[0].priority, 'high');
  assert.equal(specs[0].category, 'Búsqueda');
  assert.match(specs[0].description, /buscar documentos por título/);
  assert.equal(specs[1].title, 'Exportar diagrama');
  assert.equal(specs[1].status, 'implemented');
  assert.equal(specs[1].priority, 'low');
  assert.equal(specs[1].category, '');
  assert.match(specs[1].description, /exportar el diagrama como PNG/);
});

test('parsea valores por defecto y listas de metadatos', () => {
  const specs = parseSddSpecsMarkdown(`## Requisito sin metadatos
Solo una descripción.

## Otro requisito
- **Prioridad:** media
- **Estado:** borrador
`);
  assert.equal(specs.length, 2);
  assert.deepEqual(
    { status: specs[0].status, priority: specs[0].priority, category: specs[0].category },
    { status: 'draft', priority: 'medium', category: '' }
  );
  assert.equal(specs[1].status, 'draft');
  assert.equal(specs[1].priority, 'medium');
  assert.equal(specs[1].description, '');
});

test('genera markdown que vuelve a parsearse sin perder datos', () => {
  const original = [
    { title: 'Buscar documentos', description: 'Permite buscar por contenido.', status: 'active', priority: 'high', category: 'Búsqueda' },
    { title: 'Exportar diagramas', description: '', status: 'implemented', priority: 'low', category: '' }
  ];
  const markdown = sddSpecsToMarkdown(original);
  assert.match(markdown, /^# Specs/);
  assert.match(markdown, /\*\*Estado:\*\* Activa/);
  assert.match(markdown, /\*\*Prioridad:\*\* Baja/);
  assert.match(markdown, /\*\*Categoría:\*\* Búsqueda/);
  const reparsed = parseSddSpecsMarkdown(markdown);
  assert.deepEqual(reparsed, original);
});

before(async () => {
  fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusdata-sdd-'));
  const authStore = new MemoryAuthStore();
  api = await startServer({
    port: 0,
    dbPath: path.join(fixtureDir, 'test.db'),
    authDb: authStore,
    offlineOnly: false,
    environment: { JWT_SECRET: 'test-secret-that-is-long-enough-for-jwt-signing', SESSION_DURATION: '8h', NODE_ENV: 'test' }
  });
  await request('/auth/register', { method: 'POST', body: JSON.stringify({ username: 'sdd.tester', password: 'contraseña-muy-segura' }) });
});

test('sincroniza las specs de la base de datos desde el markdown', async () => {
  const markdown = `# Specs

## Buscar documentos
**Estado:** activa
**Prioridad:** alta
**Categoría:** Búsqueda

Permite buscar por contenido.

## Exportar diagramas
**Estado:** implementada
**Prioridad:** media
`;
  const synced = await request('/sdd/specs/sync', { method: 'POST', body: JSON.stringify({ markdown }) });
  assert.equal(synced.status, 200);
  assert.equal(synced.body.total, 2);
  const titles = synced.body.specs.map((spec) => spec.title).sort();
  assert.deepEqual(titles, ['Buscar documentos', 'Exportar diagramas']);

  const listed = await request('/sdd/specs');
  assert.equal(listed.body.specs.length, 2);
});

test('reemplaza las specs previas al volver a inyectar', async () => {
  await request('/sdd/specs', { method: 'POST', body: JSON.stringify({ title: 'Spec manual previa' }) });
  const before = await request('/sdd/specs');
  assert.equal(before.body.specs.length, 3);

  const synced = await request('/sdd/specs/sync', { method: 'POST', body: JSON.stringify({ markdown: '## Solo esta spec\n**Prioridad:** alta\nNueva descripción.' }) });
  assert.equal(synced.body.total, 1);
  assert.equal(synced.body.specs[0].title, 'Solo esta spec');
  assert.equal(synced.body.specs[0].priority, 'high');

  const after = await request('/sdd/specs');
  assert.equal(after.body.specs.length, 1);
});

test('rechaza un markdown sin specs', async () => {
  const response = await request('/sdd/specs/sync', { method: 'POST', body: JSON.stringify({ markdown: '# Solo título' }) });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /No se encontraron specs/);
});

test('expone el markdown de las specs y vuelve a sincronizarse sin cambios', async () => {
  const markdown = await request('/sdd/specs/markdown');
  assert.match(markdown.body.markdown, /^# Specs/);
  assert.match(markdown.body.markdown, /## Solo esta spec/);
  const totalBefore = (await request('/sdd/specs')).body.specs.length;
  const reSynced = await request('/sdd/specs/sync', { method: 'POST', body: JSON.stringify({ markdown: markdown.body.markdown }) });
  assert.equal(reSynced.body.total, totalBefore);
  const totalAfter = (await request('/sdd/specs')).body.specs.length;
  assert.equal(totalAfter, totalBefore);
});

after(async () => {
  await api.close();
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});