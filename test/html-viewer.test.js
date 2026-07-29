const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inspectHtmlProject } = require('../server/services/html-viewer');
const { readFileDocument } = require('../server/importers/local');

test('inspecciona un proyecto HTML y conserva sus rutas relativas', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusdata-html-'));
  try {
    fs.mkdirSync(path.join(root, 'assets'));
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><link rel="stylesheet" href="assets/styles.css"><script src="assets/app.js"></script>');
    fs.writeFileSync(path.join(root, 'assets', 'styles.css'), '#app { color: red; }');
    fs.writeFileSync(path.join(root, 'assets', 'app.js'), 'document.body.dataset.ready = "yes";');
    fs.writeFileSync(path.join(root, 'notes.md'), '# No forma parte de la previsualización');

    const project = inspectHtmlProject([root]);

    assert.equal(project.entry, 'index.html');
    assert.deepEqual(project.files.map((file) => file.relativePath), ['assets/app.js', 'assets/styles.css', 'index.html']);
    assert.equal(project.files.find((file) => file.name === 'app.js').type, 'javascript');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('el importador local reconoce HTML, CSS y JavaScript', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusdata-web-files-'));
  try {
    const paths = ['index.html', 'styles.css', 'app.js'];
    paths.forEach((file) => fs.writeFileSync(path.join(root, file), 'contenido'));
    assert.equal(readFileDocument(path.join(root, 'index.html')).type, 'html');
    assert.equal(readFileDocument(path.join(root, 'styles.css')).type, 'css');
    assert.equal(readFileDocument(path.join(root, 'app.js')).type, 'javascript');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
