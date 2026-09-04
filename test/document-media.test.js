const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, before, after } = require('node:test');
const { startServer } = require('../server/app');

const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const GIF_1PX = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');

let api;
let root;
let mediaDir;
let cookie = '';

async function request(route, options = {}) {
  const { headers, ...rest } = options;
  const response = await fetch(`http://127.0.0.1:${api.port}/api${route}`, {
    ...rest,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(headers || {}) }
  });
  const nextCookie = response.headers.getSetCookie?.()[0] || response.headers.get('set-cookie');
  if (nextCookie) cookie = nextCookie.split(';', 1)[0];
  return response;
}

async function requestJson(route, options = {}) {
  const response = await request(route, options);
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  return { response, body };
}

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusdata-media-'));
  mediaDir = path.join(root, 'media');
  fs.mkdirSync(mediaDir);
  fs.writeFileSync(path.join(mediaDir, 'foto_test.png'), PNG_1PX);
  fs.writeFileSync(path.join(mediaDir, 'animacion.gif'), GIF_1PX);
  fs.writeFileSync(path.join(mediaDir, 'clip_demo.mp4'), Buffer.concat([Buffer.from('000000206674797069736F6D', 'hex'), Buffer.alloc(512, 7)]));
  fs.writeFileSync(path.join(mediaDir, 'nota.md'), '# Nota de prueba\n');
  api = await startServer({
    port: 0,
    dbPath: path.join(root, 'nexusdata.db'),
    environment: { JWT_SECRET: 'media-test-secret-that-is-long-enough', NODE_ENV: 'test' }
  });
  const offline = await requestJson('/auth/offline', { method: 'POST' });
  assert.equal(offline.response.status, 200);
  const source = await requestJson('/sources', { method: 'POST', body: JSON.stringify({ name: 'Media', type: 'local', config: { paths: [mediaDir] } }) });
  assert.equal(source.response.status, 201);
  const sync = await requestJson(`/sources/${source.body.id}/sync`, { method: 'POST' });
  assert.equal(sync.response.status, 200);
});

test('importa multimedia con tipos y metadatos de medio', async () => {
  const { body } = await requestJson('/documents');
  const byTitle = Object.fromEntries(body.documents.map((doc) => [doc.title, doc]));
  assert.equal(byTitle['foto test'].type, 'image');
  assert.equal(byTitle['foto test'].metadata.mediaKind, 'image');
  assert.equal(byTitle['foto test'].metadata.mediaMime, 'image/png');
  assert.equal(byTitle['animacion'].type, 'gif');
  assert.equal(byTitle['animacion'].metadata.mediaKind, 'image');
  assert.equal(byTitle['clip demo'].type, 'video');
  assert.equal(byTitle['clip demo'].metadata.mediaKind, 'video');
  assert.equal(byTitle['nota'].type, 'markdown');
});

test('sirve el archivo multimedia con MIME correcto y soporte de rango', async () => {
  const { body } = await requestJson('/documents');
  const png = body.documents.find((doc) => doc.type === 'image');
  const full = await request(`/documents/${png.id}/file`);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), PNG_1PX);

  const partial = await request(`/documents/${png.id}/file`, { headers: { Range: 'bytes=0-3' } });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('content-range'), `bytes 0-3/${PNG_1PX.length}`);
  assert.equal((await partial.arrayBuffer()).byteLength, 4);

  const gif = body.documents.find((doc) => doc.type === 'gif');
  const gifResponse = await request(`/documents/${gif.id}/file`);
  assert.equal(gifResponse.headers.get('content-type'), 'image/gif');

  const video = body.documents.find((doc) => doc.type === 'video');
  const videoResponse = await request(`/documents/${video.id}/file`);
  assert.equal(videoResponse.headers.get('content-type'), 'video/mp4');
});

test('el buscador encuentra multimedia por título y el detalle no corrompe el contenido', async () => {
  const search = await requestJson('/search?q=foto');
  assert.ok(search.body.results.some((doc) => doc.type === 'image'));
  const { body } = await requestJson('/documents');
  const png = body.documents.find((doc) => doc.type === 'image');
  const detail = await requestJson(`/documents/${png.id}`);
  assert.equal(detail.response.status, 200);
  assert.equal(detail.body.content, '');
  assert.equal(detail.body.metadata.mediaKind, 'image');
});

test('rechaza el stream cuando el archivo desaparece o la ruta no es multimedia', async () => {
  const { body } = await requestJson('/documents');
  const markdown = body.documents.find((doc) => doc.type === 'markdown');
  const notMedia = await request(`/documents/${markdown.id}/file`);
  assert.equal(notMedia.status, 404);

  const png = body.documents.find((doc) => doc.type === 'image');
  fs.rmSync(path.join(mediaDir, 'foto_test.png'));
  const missing = await request(`/documents/${png.id}/file`);
  assert.equal(missing.status, 404);
});

after(async () => {
  await api.close();
  fs.rmSync(root, { recursive: true, force: true });
});
