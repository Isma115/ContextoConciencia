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

async function request(route, options = {}, projectPath = '') {
  const { headers: optionHeaders = {}, ...fetchOptions } = options;
  const headers = {
    'Content-Type': 'application/json',
    ...(sessionCookie ? { Cookie: sessionCookie } : {}),
    ...(projectPath ? { 'X-SDD-Project-Path': projectPath } : {}),
    ...optionHeaders
  };
  const response = await fetch(`http://127.0.0.1:${api.port}/api${route}`, { ...fetchOptions, headers });
  const cookie = response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie');
  if (cookie) sessionCookie = cookie.split(';', 1)[0];
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  return { status: response.status, ok: response.ok, body };
}

function createProject(name, markdown) {
  const projectPath = path.join(fixtureDir, name);
  fs.mkdirSync(path.join(projectPath, 'specs_resources'), { recursive: true });
  fs.writeFileSync(path.join(projectPath, 'specs.md'), markdown, 'utf8');
  return projectPath;
}

async function loadProject(projectPath) {
  const loaded = await request('/sdd/project', { method: 'POST', body: JSON.stringify({ path: projectPath }) });
  assert.equal(loaded.status, 200);
  assert.equal(loaded.body.project.path, fs.realpathSync(projectPath));
  return loaded;
}

test('parsea encabezados de specs.md con estado y categoría', () => {
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
  assert.equal(specs[0].priority, undefined);
  assert.equal(specs[0].category, 'Búsqueda');
  assert.match(specs[0].description, /buscar documentos por título/);
  assert.equal(specs[1].title, 'Exportar diagrama');
  assert.equal(specs[1].status, 'implemented');
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
    { status: specs[0].status, category: specs[0].category },
    { status: 'draft', category: '' }
  );
  assert.equal(specs[1].status, 'draft');
  assert.equal(specs[1].description, '');
});

test('genera markdown que vuelve a parsearse sin perder datos', () => {
  const original = [
    { title: 'Buscar documentos', description: 'Permite buscar por contenido.', status: 'active', category: 'Búsqueda' },
    { title: 'Exportar diagramas', description: '', status: 'implemented', category: '' }
  ];
  const markdown = sddSpecsToMarkdown(original);
  assert.match(markdown, /^# Specs/);
  assert.match(markdown, /\*\*Estado:\*\* Activa/);
  assert.doesNotMatch(markdown, /Prioridad/);
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

test('no conserva proyecto S.D.D en el servidor y exige contexto por petición', async () => {
  const unloaded = await request('/sdd/project');
  assert.equal(unloaded.status, 200);
  assert.equal(unloaded.body.loaded, false);
  const missingContext = await request('/sdd/specs');
  assert.equal(missingContext.status, 400);
  assert.match(missingContext.body.error, /carpeta del proyecto S\.D\.D/);
});

test('carga specs.md y refleja cambios externos sin sincronizar una base local', async () => {
  const projectPath = createProject('sdd-project-specs', `# Specs

## Requisito inicial
**Estado:** activa
`);
  const loaded = await loadProject(projectPath);
  assert.equal(loaded.body.total, 1);
  assert.equal((await request('/sdd/specs', {}, projectPath)).body.specs[0].title, 'Requisito inicial');

  fs.writeFileSync(path.join(projectPath, 'specs.md'), '# Specs\n\n## Requisito actualizado\n**Estado:** implementada\n', 'utf8');
  const listed = await request('/sdd/specs', {}, projectPath);
  assert.deepEqual(listed.body.specs.map((spec) => spec.title), ['Requisito actualizado']);
  assert.equal(listed.body.specs[0].status, 'implemented');

  const sddTables = api.app.locals.db.raw.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'sdd_%'").all();
  assert.deepEqual(sddTables, []);
});

test('sincroniza el editor y CRUD de Specs directamente en specs.md', async () => {
  const projectPath = createProject('sdd-project-spec-crud', '# Specs\n\n## Primera spec\n**Estado:** activa\n');
  await loadProject(projectPath);
  const markdown = await request('/sdd/specs/markdown', {}, projectPath);
  assert.match(markdown.body.markdown, /## Primera spec/);

  const synced = await request('/sdd/specs/sync', {
    method: 'POST',
    body: JSON.stringify({ markdown: '# Specs\n\n## Desde editor\n**Estado:** aprobada\n\nDescripción editada.\n' })
  }, projectPath);
  assert.equal(synced.body.total, 1);
  assert.match(fs.readFileSync(path.join(projectPath, 'specs.md'), 'utf8'), /## Desde editor/);

  const created = await request('/sdd/specs', { method: 'POST', body: JSON.stringify({ title: 'Añadida', status: 'draft', description: 'Texto' }) }, projectPath);
  assert.equal(created.status, 201);
  assert.match(fs.readFileSync(path.join(projectPath, 'specs.md'), 'utf8'), /## Añadida/);
  const updated = await request(`/sdd/specs/${created.body.id}`, { method: 'PUT', body: JSON.stringify({ title: 'Añadida actualizada', status: 'implemented' }) }, projectPath);
  assert.equal(updated.status, 200);
  assert.match(fs.readFileSync(path.join(projectPath, 'specs.md'), 'utf8'), /## Añadida actualizada/);
  const removed = await request(`/sdd/specs/${created.body.id}`, { method: 'DELETE' }, projectPath);
  assert.equal(removed.status, 204);
  assert.doesNotMatch(fs.readFileSync(path.join(projectPath, 'specs.md'), 'utf8'), /## Añadida actualizada/);
});

test('guarda Base de datos en el bloque S.D.D de specs.md y lo vuelve a leer del disco', async () => {
  const projectPath = createProject('sdd-project-db-file', '# Specs\n\n## Requisito de datos\n');
  await loadProject(projectPath);
  const created = await request('/sdd/db/tables', { method: 'POST', body: JSON.stringify({ name: 'usuarios', description: 'Personas' }) }, projectPath);
  assert.equal(created.status, 201);
  const column = await request(`/sdd/db/tables/${created.body.id}/columns`, {
    method: 'POST',
    body: JSON.stringify({ name: 'id', type: 'INTEGER', primaryKey: true, nullable: false })
  }, projectPath);
  assert.equal(column.status, 201);
  const raw = fs.readFileSync(path.join(projectPath, 'specs.md'), 'utf8');
  assert.match(raw, /nexusdata:sdd-database:start/);
  assert.match(raw, /"name": "usuarios"/);
  assert.match(raw, /"name": "id"/);

  const listed = await request('/sdd/db', {}, projectPath);
  assert.equal(listed.body.tables[0].name, 'usuarios');
  assert.equal(listed.body.tables[0].columns[0].name, 'id');

  fs.writeFileSync(path.join(projectPath, 'specs.md'), raw.replace('"usuarios"', '"usuarios_externos"'), 'utf8');
  const externallyUpdated = await request('/sdd/db', {}, projectPath);
  assert.equal(externallyUpdated.body.tables[0].name, 'usuarios_externos');
});

test('guarda UI en specs.md y los ficheros multimedia en specs_resources', async () => {
  const projectPath = createProject('sdd-project-ui-file', '# Specs\n\n## Requisito visual\n');
  await loadProject(projectPath);
  const text = await request('/sdd/media?kind=text&title=Nota%20UI&description=Contexto', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: Buffer.from('Contenido visual')
  }, projectPath);
  assert.equal(text.status, 201);
  assert.equal((await request('/sdd/media', {}, projectPath)).body.media[0].content, 'Contenido visual');

  const image = await request('/sdd/media?kind=image&title=Pantalla&fileName=screen.png', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: Buffer.from([137, 80, 78, 71])
  }, projectPath);
  assert.equal(image.status, 201);
  assert.equal(fs.existsSync(path.join(projectPath, 'specs_resources', 'screen.png')), true);
  assert.match(fs.readFileSync(path.join(projectPath, 'specs.md'), 'utf8'), /nexusdata:sdd-ui:start/);
  assert.equal((await request('/sdd/media', {}, projectPath)).body.media.some((item) => item.fileName === 'screen.png'), true);
});

test('mantiene aislados dos proyectos porque cada petición lee sus propios ficheros', async () => {
  const firstProject = createProject('sdd-project-a', '# Specs\n\n## Proyecto A\n');
  const secondProject = createProject('sdd-project-b', '# Specs\n\n## Proyecto B\n');
  await loadProject(firstProject);
  const table = await request('/sdd/db/tables', { method: 'POST', body: JSON.stringify({ name: 'tabla-a' }) }, firstProject);
  await request('/sdd/media?kind=text&title=UI%20A', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: Buffer.from('UI del proyecto A')
  }, firstProject);

  await loadProject(secondProject);
  assert.deepEqual((await request('/sdd/specs', {}, secondProject)).body.specs.map((spec) => spec.title), ['Proyecto B']);
  assert.deepEqual((await request('/sdd/db', {}, secondProject)).body.tables, []);
  assert.deepEqual((await request('/sdd/media', {}, secondProject)).body.media, []);

  assert.equal((await request('/sdd/db', {}, firstProject)).body.tables[0].name, 'tabla-a');
  assert.equal((await request('/sdd/media', {}, firstProject)).body.media[0].title, 'UI A');
  assert.ok(table.body.id);
});

after(async () => {
  await api.close();
  fs.rmSync(fixtureDir, { recursive: true, force: true });
});
