const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { openDatabase, now } = require('../server/database/db');
const { upsertDocument } = require('../server/services/documents');
const { searchDocuments } = require('../server/services/search');

const PADDING = 'Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod. ';

function temporaryDatabase() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusdata-search-'));
  return { home, database: openDatabase(path.join(home, 'test.db')) };
}

function insertSource(database, id) {
  database.run(
    'INSERT INTO sources (id, name, type, config_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    id,
    'Fuente de prueba',
    'local',
    '{}',
    'ready',
    now()
  );
}

function insertDocument(database, sourceId, id, title, content) {
  upsertDocument(database, sourceId, {
    externalId: `${id}.md`,
    title,
    content,
    type: 'markdown',
    path: `${id}.md`,
    metadata: {}
  });
}

test('centra el snippet en la coincidencia y marca su rango resaltado', () => {
  const { home, database } = temporaryDatabase();
  try {
    insertSource(database, 'source_test');
    insertDocument(database, 'source_test', 'guia', 'Guía de campo', `${PADDING.repeat(6)}El mineral aparece bajo una capa de asterisco de mar profundo. ${PADDING.repeat(6)}`);

    const results = searchDocuments(database, 'ASTERISCO de mar', {}, { localOnly: true });
    const result = results.find((document) => document.title === 'Guía de campo');
    assert.ok(result);
    assert.ok(result.snippet.startsWith('…'));
    assert.equal(result.snippet.slice(result.highlight[0], result.highlight[1]).toLocaleLowerCase(), 'asterisco de mar');
  } finally {
    database.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('resalta la mejor palabra cuando la frase exacta no aparece en el contenido', () => {
  const { home, database } = temporaryDatabase();
  try {
    insertSource(database, 'source_test');
    insertDocument(database, 'source_test', 'estudio', 'Retrato fotogénico del paisaje', `${PADDING.repeat(6)}bajo la luz aparece un efecto fotogénico raro. ${PADDING.repeat(6)}`);

    const results = searchDocuments(database, 'retrato fotogénico', {}, { localOnly: true });
    const result = results.find((document) => document.title === 'Retrato fotogénico del paisaje');
    assert.ok(result);
    assert.ok(result.snippet.includes('fotogénico'));
    assert.ok(result.snippet.indexOf('fotogénico') > 10, 'el snippet debe centrarse en la coincidencia');
    assert.equal(result.snippet.slice(result.highlight[0], result.highlight[1]), 'fotogénico');
  } finally {
    database.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test('sin coincidencia en el contenido no hay rango resaltado', () => {
  const { home, database } = temporaryDatabase();
  try {
    insertSource(database, 'source_test');
    insertDocument(database, 'source_test', 'zephyr', 'Zephyr', `${PADDING.repeat(6)}`);

    const results = searchDocuments(database, 'Zephyr', {}, { localOnly: true });
    const result = results.find((document) => document.title === 'Zephyr');
    assert.ok(result);
    assert.equal(result.highlight, null);
  } finally {
    database.close();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
