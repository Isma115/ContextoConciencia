const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { openDatabase, now } = require('../server/database/db');
const { collectFiles, importLocalSource, MAX_FILES } = require('../server/importers/local');
const { upsertDocument } = require('../server/services/documents');
const { searchDocuments } = require('../server/routes');
const {
  COMMON_DIRECTORY_DEFINITIONS,
  COMMON_PATHS_ROLE,
  COMMON_SCAN_EXCLUDED_DIRECTORIES,
  commonPathsConfig,
  listCommonDirectories
} = require('../server/services/common-paths');

function temporaryHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'nexusdata-common-paths-'));
}

test('lista las rutas comunes existentes con nombres localizados', () => {
  const home = temporaryHome();
  try {
    ['Documents', 'Descargas', 'Pictures', 'Escritorio', 'Projects', 'Código'].forEach((name) => fs.mkdirSync(path.join(home, name)));
    const directories = listCommonDirectories({ homeDirectory: home });

    assert.equal(COMMON_DIRECTORY_DEFINITIONS.length, 9);
    assert.deepEqual(directories.map((directory) => directory.label), [
      'Documentos',
      'Descargas',
      'Imágenes',
      'Escritorio',
      'Proyectos',
      'Código'
    ]);
    assert.equal(commonPathsConfig(directories).role, COMMON_PATHS_ROLE);
    assert.ok(commonPathsConfig(directories).excludeDirectories.includes('node_modules'));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('omite carpetas técnicas al recoger documentos de las rutas comunes', () => {
  const home = temporaryHome();
  const projects = path.join(home, 'Projects');
  try {
    fs.mkdirSync(path.join(projects, 'src'), { recursive: true });
    fs.mkdirSync(path.join(projects, 'node_modules', 'paquete'), { recursive: true });
    fs.mkdirSync(path.join(projects, '.git'), { recursive: true });
    fs.writeFileSync(path.join(projects, 'README.md'), '# Proyecto local');
    fs.writeFileSync(path.join(projects, 'src', 'notas.txt'), 'Contenido indexable');
    fs.writeFileSync(path.join(projects, 'node_modules', 'paquete', 'README.md'), 'No indexar');
    fs.writeFileSync(path.join(projects, '.git', 'config.md'), 'No indexar');

    const files = collectFiles(projects, [], {
      skipDirectories: COMMON_SCAN_EXCLUDED_DIRECTORIES,
      ignoreErrors: true,
      followSymlinks: false
    }).map((filePath) => path.relative(projects, filePath)).sort();

    assert.deepEqual(files, ['README.md', path.join('src', 'notas.txt')]);
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('reparte el límite de archivos entre las rutas comunes', () => {
  const home = temporaryHome();
  const documents = path.join(home, 'Documents');
  const downloads = path.join(home, 'Downloads');
  const database = openDatabase(path.join(home, 'test.db'));
  try {
    fs.mkdirSync(documents);
    fs.mkdirSync(downloads);
    for (let index = 0; index <= MAX_FILES; index += 1) {
      fs.writeFileSync(path.join(documents, `document-${String(index).padStart(4, '0')}.md`), `Documento ${index}`);
    }
    const downloadPath = path.join(downloads, 'descarga.md');
    fs.writeFileSync(downloadPath, 'Documento de Descargas');

    const source = { id: 'source_common', config_json: JSON.stringify({
      role: COMMON_PATHS_ROLE,
      paths: [documents, downloads],
      excludeDirectories: [],
      ignoreErrors: true,
      followSymlinks: false
    }) };
    dbInsertSource(database, source.id, 'Rutas comunes', source.config_json);
    const result = importLocalSource(database, source, { prune: true, includeUnsupported: false });

    assert.equal(result.total, MAX_FILES);
    assert.equal(database.get('SELECT COUNT(*) AS count FROM documents WHERE source_id = ?', source.id).count, MAX_FILES);
    assert.ok(database.get('SELECT id FROM documents WHERE source_id = ? AND external_id = ?', source.id, downloadPath));
  } finally {
    database.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('mantiene las rutas comunes fuera de la búsqueda hasta activarlas', () => {
  const home = temporaryHome();
  const database = openDatabase(path.join(home, 'test.db'));
  try {
    const localSourceId = 'source_local';
    const commonSourceId = 'source_common';
    dbInsertSource(database, localSourceId, 'Proyecto local', '{}');
    dbInsertSource(database, commonSourceId, 'Rutas comunes', JSON.stringify({ role: COMMON_PATHS_ROLE }));
    upsertDocument(database, localSourceId, {
      externalId: path.join(home, 'project.md'),
      title: 'Proyecto local',
      content: 'Contenido del proyecto',
      type: 'markdown',
      path: path.join(home, 'project.md'),
      metadata: {}
    });
    upsertDocument(database, commonSourceId, {
      externalId: path.join(home, 'Documents', 'privado.md'),
      title: 'Documento personal',
      content: 'clave-ruta-comun-9f3',
      type: 'markdown',
      path: path.join(home, 'Documents', 'privado.md'),
      metadata: {}
    });

    const hidden = searchDocuments(database, 'clave-ruta-comun-9f3', {}, { localOnly: true, includeCommonPaths: false });
    const expanded = searchDocuments(database, 'clave-ruta-comun-9f3', {}, { localOnly: true, includeCommonPaths: true });
    assert.ok(hidden.every((document) => document.source !== 'Rutas comunes'));
    assert.ok(expanded.some((document) => document.source === 'Rutas comunes'));
  } finally {
    database.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

function dbInsertSource(database, id, name, config) {
  database.run(
    'INSERT INTO sources (id, name, type, config_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    id,
    name,
    'local',
    config,
    'ready',
    now()
  );
}
