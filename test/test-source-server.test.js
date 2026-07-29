const assert = require('node:assert/strict');
const { test } = require('node:test');
const { startTestSourceServer } = require('../test-source-server/server');

test('sirve el índice REST y el documento Markdown por HTTP', async (t) => {
  const source = await startTestSourceServer({ port: 0, host: '127.0.0.1' });
  t.after(() => new Promise((resolve) => source.server.close(resolve)));

  const indexResponse = await fetch(`http://127.0.0.1:${source.port}/documents`);
  assert.equal(indexResponse.status, 200);
  assert.match(indexResponse.headers.get('content-type'), /^application\/json/);
  const index = await indexResponse.json();
  assert.equal(index.data.length, 1);
  assert.equal(index.data[0].id, 'documento-prueba.md');
  assert.match(index.data[0].description, /Documento remoto de prueba/);

  const documentResponse = await fetch(`http://127.0.0.1:${source.port}/documents/documento-prueba.md`);
  assert.equal(documentResponse.status, 200);
  assert.match(documentResponse.headers.get('content-type'), /^text\/markdown/);
  assert.match(await documentResponse.text(), /^# Documento remoto de prueba/);
});
