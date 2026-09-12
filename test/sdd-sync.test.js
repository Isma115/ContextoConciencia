const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');
const { startServer } = require('../server/app');
const { parseSddDocument, parseSddSpecsMarkdown, sddSpecsToMarkdown } = require('../server/routes/sdd');

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
  assert.match(markdown, /- Estado: Activa/);
  assert.doesNotMatch(markdown, /Prioridad/);
  assert.match(markdown, /- Categoría: Búsqueda/);
  const reparsed = parseSddSpecsMarkdown(markdown);
  assert.deepEqual(reparsed, original);
});

test('parsea Specs, BBDD y UI desde secciones Markdown sin JSON', () => {
  const document = parseSddDocument(`# Specs

## Buscar documentos
- Estado: Implementada
- Categoría: Búsqueda

Busca por título y contenido.

# BBDD

## usuarios

Personas registradas.

| Columna | Tipo | Nulo | Clave | Predeterminado | Descripción |
| --- | --- | --- | --- | --- | --- |
| id | INTEGER | No | PK | — | Identificador |
| nombre | TEXT | Sí | — | — | Nombre visible |

# UI

## Inicio
- Tipo: Imagen
- Archivo: specs_resources/inicio.png
- Descripción: Pantalla principal.

## Sonido de inicio
- Tipo: Audio
- Archivo: specs_resources/inicio.mp3

# Recursos

- specs_resources/inicio.png — Imagen
`);
  assert.equal(document.specs[0].status, 'implemented');
  assert.equal(document.database.tables[0].name, 'usuarios');
  assert.deepEqual(document.database.tables[0].columns[0], {
    id: document.database.tables[0].columns[0].id,
    name: 'id', type: 'INTEGER', nullable: false, primaryKey: true, defaultValue: '', description: 'Identificador', position: 0
  });
  assert.equal(document.media.media[0].fileName, 'inicio.png');
  assert.equal(document.media.media[1].kind, 'audio');
  assert.equal(document.media.media[1].fileName, 'inicio.mp3');
  assert.equal(document.sections.resources, true);
});

test('mantiene lectura del formato JSON heredado hasta que se guarde de nuevo', () => {
  const document = parseSddDocument(`# Specs

## Requisito heredado
**Estado:** Activa

<!-- nexusdata:sdd-database:start -->
{"tables":[{"name":"usuarios","columns":[]}]}
<!-- nexusdata:sdd-database:end -->

<!-- nexusdata:sdd-ui:start -->
{"media":[{"title":"Nota","kind":"text","content":"Texto heredado"}]}
<!-- nexusdata:sdd-ui:end -->
`);
  assert.equal(document.database.tables[0].name, 'usuarios');
  assert.equal(document.media.media[0].content, 'Texto heredado');
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

test('guarda Base de datos como una tabla Markdown y la vuelve a leer del disco', async () => {
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
  assert.match(raw, /^# BBDD$/m);
  assert.match(raw, /^## usuarios$/m);
  assert.match(raw, /\| `id` \| `INTEGER` \| No \| PK \| — \| — \|/);
  assert.doesNotMatch(raw, /nexusdata:sdd-|"tables"/);

  const listed = await request('/sdd/db', {}, projectPath);
  assert.equal(listed.body.tables[0].name, 'usuarios');
  assert.equal(listed.body.tables[0].columns[0].name, 'id');

  fs.writeFileSync(path.join(projectPath, 'specs.md'), raw.replace('## usuarios', '## usuarios_externos'), 'utf8');
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
  assert.doesNotMatch(image.body.fileUrl, /^data:/);
  assert.match(image.body.fileUrl, /\/api\/sdd\/media\//);
  assert.equal(fs.existsSync(path.join(projectPath, 'specs_resources', 'screen.png')), true);
  const audio = await request('/sdd/media?kind=audio&title=Sonido&fileName=click.mp3', {
    method: 'POST',
    headers: { 'Content-Type': 'audio/mpeg' },
    body: Buffer.from([0x49, 0x44, 0x33])
  }, projectPath);
  assert.equal(audio.status, 201);
  assert.equal(fs.existsSync(path.join(projectPath, 'specs_resources', 'click.mp3')), true);
  const raw = fs.readFileSync(path.join(projectPath, 'specs.md'), 'utf8');
  assert.match(raw, /^# UI$/m);
  assert.match(raw, /^## Pantalla$/m);
  assert.match(raw, /- Archivo: `specs_resources\/screen.png`/);
  assert.match(raw, /^# Recursos$/m);
  assert.match(raw, /- `specs_resources\/screen.png` — Imagen/);
  assert.match(raw, /- `specs_resources\/click.mp3` — Audio/);
  assert.doesNotMatch(raw, /nexusdata:sdd-|"media"/);
  const media = (await request('/sdd/media', {}, projectPath)).body.media;
  assert.equal(media.some((item) => item.fileName === 'screen.png'), true);
  assert.equal(media.some((item) => item.fileName === 'click.mp3' && item.kind === 'audio'), true);
});

test('acelera la gestión de requisitos con duplicado, edición masiva, orden y reporte', async () => {
  const projectPath = createProject('sdd-project-productivity', `# Specs

## Buscar anuncios
- Estado: Borrador
- Categoría: Catálogo

El usuario puede buscar anuncios.

## Guardar favoritos
- Estado: Activa
- Categoría: Cuenta

El usuario puede guardar favoritos.

## Contactar vendedor
- Estado: Aprobada
- Categoría: Mensajería

El usuario puede contactar con el vendedor.

# BBDD

## anuncios
Catálogo de anuncios.

| Columna | Tipo | Nulo | Clave | Predeterminado | Descripción |
| --- | --- | --- | --- | --- | --- |
| id | INTEGER | No | PK | — | Identificador |

# UI

## Pantalla de catálogo
- Tipo: Texto
- Descripción: Buscar anuncios y guardar favoritos.
`);
  await loadProject(projectPath);
  const initial = await request('/sdd/specs', {}, projectPath);
  const ids = initial.body.specs.map((spec) => spec.id);
  assert.equal(ids.length, 3);

  const bulk = await request('/sdd/specs/bulk', {
    method: 'PATCH',
    body: JSON.stringify({ ids: ids.slice(0, 2), changes: { status: 'approved', category: 'Producto' } })
  }, projectPath);
  assert.equal(bulk.status, 200);
  assert.equal(bulk.body.updated.length, 2);
  assert.deepEqual(bulk.body.updated.map((spec) => spec.status), ['approved', 'approved']);

  const duplicate = await request(`/sdd/specs/${ids[0]}/duplicate`, { method: 'POST', body: JSON.stringify({}) }, projectPath);
  assert.equal(duplicate.status, 201);
  assert.match(duplicate.body.title, /^Copia de Buscar anuncios/);

  const afterDuplicate = (await request('/sdd/specs', {}, projectPath)).body.specs;
  const reordered = await request('/sdd/specs/reorder', {
    method: 'POST',
    body: JSON.stringify({ ids: [...afterDuplicate].reverse().map((spec) => spec.id) })
  }, projectPath);
  assert.equal(reordered.status, 200);
  assert.equal(reordered.body.specs[0].title, afterDuplicate.at(-1).title);

  const report = await request('/sdd/report', {}, projectPath);
  assert.equal(report.status, 200);
  assert.equal(report.body.coverageMatrix.length, 4);
  assert.equal(report.body.summary.tables, 1);
  assert.equal(report.body.summary.ui, 1);
  assert.equal(typeof report.body.summary.coveragePercent, 'number');
});

test('gestiona recursos con carpetas, filtros, referencias y stream por rangos', async () => {
  const projectPath = createProject('sdd-project-resources', `# Specs

## Requisito con icono
Descripción del requisito.

# UI

## Icono de inicio
- Tipo: Imagen
- Archivo: specs_resources/icon.png

# Recursos

- specs_resources/icon.png — Imagen
`);
  fs.writeFileSync(path.join(projectPath, 'specs_resources', 'icon.png'), Buffer.from('not-a-real-png'));
  await loadProject(projectPath);

  const initial = await request('/sdd/resources', {}, projectPath);
  assert.equal(initial.status, 200);
  assert.equal(initial.body.resources.length, 1);
  assert.equal(initial.body.resources[0].referenced, true);
  assert.equal(initial.body.resources[0].dataUrl, undefined);
  assert.match(initial.body.resources[0].fileUrl, /\/api\/sdd\/resources\/file\?/);

  const rangeUrl = `http://127.0.0.1:${api.port}/api/sdd/resources/file?projectPath=${encodeURIComponent(projectPath)}&fileName=icon.png`;
  const ranged = await fetch(rangeUrl, { headers: { Range: 'bytes=0-3', Cookie: sessionCookie } });
  assert.equal(ranged.status, 206);
  assert.equal(ranged.headers.get('accept-ranges'), 'bytes');
  assert.deepEqual(Buffer.from(await ranged.arrayBuffer()), Buffer.from('not-'));

  const folder = await request('/sdd/resources/folders', {
    method: 'POST',
    body: JSON.stringify({ path: 'audio/ui' })
  }, projectPath);
  assert.equal(folder.status, 201);

  const uploaded = await request('/sdd/resources?fileName=audio%2Fui%2Fvoice.bin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' },
    body: Buffer.from([0x49, 0x44, 0x33, 0x01])
  }, projectPath);
  assert.equal(uploaded.status, 201);
  assert.equal(uploaded.body.kind, 'audio');
  assert.equal(uploaded.body.relativePath, 'audio/ui/voice.bin');

  const filtered = await request('/sdd/resources?q=voice&kind=audio', {}, projectPath);
  assert.deepEqual(filtered.body.resources.map((resource) => resource.relativePath), ['audio/ui/voice.bin']);

  const renamed = await request('/sdd/resources', {
    method: 'PATCH',
    body: JSON.stringify({ fileName: 'icon.png', newName: 'icon-home.png' })
  }, projectPath);
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.updatedReferences, true);
  assert.match(fs.readFileSync(path.join(projectPath, 'specs.md'), 'utf8'), /specs_resources\/icon-home\.png/);

  const blocked = await request('/sdd/resources', {
    method: 'DELETE',
    body: JSON.stringify({ fileName: 'icon-home.png' })
  }, projectPath);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, 'RESOURCE_REFERENCES');
  assert.equal(blocked.body.references.length, 1);

  const deleted = await request('/sdd/resources', {
    method: 'DELETE',
    body: JSON.stringify({ fileName: 'icon-home.png', confirmReferences: true })
  }, projectPath);
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.referencesPreserved, true);
  assert.equal(fs.existsSync(path.join(projectPath, 'specs_resources', 'icon-home.png')), false);
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
