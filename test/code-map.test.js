const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { analyzeCodeMap, getCodeMapFile, listCodeMapFiles } = require('../server/services/code-map');

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusdata-code-map-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules', 'fake'), { recursive: true });
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'entry.ts'), "import { helper } from './helper';\nexport const entry = () => helper();\n");
  fs.writeFileSync(path.join(root, 'src', 'helper.ts'), "import { entry } from './entry';\nexport function helper() { return entry(); }\n");
  fs.writeFileSync(path.join(root, 'index.html'), '<link rel="stylesheet" href="styles.css"><script src="src/entry.ts"></script>');
  fs.writeFileSync(path.join(root, 'styles.css'), '@import "theme.css";\nbody { color: red; }');
  fs.writeFileSync(path.join(root, 'theme.css'), ':root { --accent: red; }');
  fs.writeFileSync(path.join(root, 'node_modules', 'fake', 'ignored.js'), 'export const ignored = true;');
  fs.writeFileSync(path.join(root, 'dist', 'generated.js'), 'export const generated = true;');
  return root;
}

test('descubre solo ficheros compatibles y aplica exclusiones técnicas', () => {
  const root = fixture();
  try {
    const result = listCodeMapFiles(root);
    assert.deepEqual(result.files.map((file) => file.path), ['index.html', 'src/entry.ts', 'src/helper.ts', 'styles.css', 'theme.css']);
    assert.equal(result.files.some((file) => file.path.includes('node_modules')), false);
    assert.equal(result.files.some((file) => file.path.startsWith('dist/')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('construye relaciones, detecta ciclos y calcula el subgrafo desde una entrada', () => {
  const root = fixture();
  try {
    const complete = analyzeCodeMap(root);
    assert.equal(complete.summary.files, 5);
    assert.ok(complete.files.find((file) => file.path === 'src/entry.ts').symbols.some((symbol) => symbol.name === 'entry' && symbol.exported));
    assert.ok(complete.relations.some((relation) => relation.kind === 'imports' && relation.resolved));
    assert.ok(complete.relations.some((relation) => relation.kind === 'references-script' && relation.resolved));
    assert.ok(complete.relations.some((relation) => relation.kind === 'imports-style' && relation.resolved));
    assert.equal(complete.summary.cycles, 1);

    const partial = analyzeCodeMap(root, { scope: 'entry', entryFile: 'index.html' });
    assert.deepEqual(partial.files.map((file) => file.path), ['index.html', 'src/entry.ts', 'src/helper.ts', 'styles.css', 'theme.css']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('conserva advertencias parciales y no permite abrir rutas fuera de la raíz', () => {
  const root = fixture();
  try {
    fs.writeFileSync(path.join(root, 'broken.js'), 'export const value = "sin cerrar;');
    const result = analyzeCodeMap(root);
    assert.ok(result.warnings.some((warning) => warning.path === 'broken.js'));
    assert.throws(() => getCodeMapFile(root, '../outside.js'), /ruta.*válida|fuera/i);
    const source = getCodeMapFile(root, 'src/entry.ts', 2);
    assert.equal(source.path, 'src/entry.ts');
    assert.equal(source.line, 2);
    assert.match(source.content, /helper/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
