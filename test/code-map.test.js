const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { analyzeCodeMap, getCodeMapFile, listCodeMapFiles } = require('../server/services/code-map');
const { supportedLanguage } = require('../server/services/code-map/file-discovery');

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
    assert.deepEqual(result.folders, ['src']);
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

    const folder = analyzeCodeMap(root, { scope: 'folder', entryFolder: 'src' });
    assert.deepEqual(folder.files.map((file) => file.path), ['src/entry.ts', 'src/helper.ts']);
    assert.equal(folder.project.entryFolder, 'src');
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
    assert.throws(() => analyzeCodeMap(root, { scope: 'folder', entryFolder: '../' }), /ruta.*válida|fuera/i);
    assert.throws(() => analyzeCodeMap(root, { scope: 'folder', entryFolder: 'src/entry.ts' }), /carpeta/i);
    const source = getCodeMapFile(root, 'src/entry.ts', 2);
    assert.equal(source.path, 'src/entry.ts');
    assert.equal(source.line, 2);
    assert.match(source.content, /helper/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('reconoce lenguajes habituales y extrae símbolos y dependencias locales', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusdata-code-map-languages-'));
  const files = {
    'python/main.py': 'from .helper import greet\nclass Runner:\n    def run(self):\n        return greet()\n',
    'python/helper.py': 'def greet():\n    return "ok"\n',
    'java/src/com/example/Main.java': 'package com.example;\nimport com.example.Helper;\npublic class Main {\n  public void run() {}\n}\n',
    'java/src/com/example/Helper.java': 'package com.example;\npublic class Helper {}\n',
    'cpp/main.cpp': '#include "helper.hpp"\nint main() { return helper(); }\n',
    'cpp/helper.hpp': 'int helper();\n',
    'go/main.go': 'package main\nfunc main() {}\n',
    'rust/lib.rs': 'mod helper;\npub fn run() {}\n',
    'rust/helper.rs': 'pub fn help() {}\n',
    'php/index.php': '<?php\nfunction render() {}\n',
    'ruby/app.rb': 'def run\nend\n',
    'kotlin/App.kt': 'fun run() {}\n',
    'swift/App.swift': 'func run() {}\n',
    'dart/main.dart': 'void run() {}\n',
    'lua/main.lua': 'function run() end\n',
    'stats/report.r': 'run <- function() {}\n',
    'scala/App.scala': 'object App { def run(): Unit = {} }\n',
    'perl/app.pl': 'sub run {}\n',
    'scripts/app.sh': 'run() { echo ok; }\n',
    'scripts/app.ps1': 'function Run-App {}\n',
    'db/schema.sql': 'CREATE TABLE users (id INT);\n'
  };
  try {
    Object.entries(files).forEach(([relative, content]) => {
      const target = path.join(root, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    });
    const expectedExtensions = [
      ['py', 'python'], ['java', 'java'], ['cs', 'csharp'], ['c', 'c'], ['h', 'c'], ['cpp', 'cpp'],
      ['go', 'go'], ['rs', 'rust'], ['php', 'php'], ['rb', 'ruby'], ['kt', 'kotlin'], ['swift', 'swift'],
      ['dart', 'dart'], ['lua', 'lua'], ['r', 'r'], ['scala', 'scala'], ['pl', 'perl'], ['sh', 'shell'],
      ['ps1', 'powershell'], ['sql', 'sql']
    ];
    expectedExtensions.forEach(([extension, language]) => assert.equal(supportedLanguage(`sample.${extension}`), language));

    const discovered = listCodeMapFiles(root);
    assert.equal(discovered.files.length, Object.keys(files).length);
    assert.equal(discovered.files.find((file) => file.path === 'python/main.py').language, 'python');
    assert.equal(discovered.files.find((file) => file.path === 'java/src/com/example/Main.java').language, 'java');

    const result = analyzeCodeMap(root);
    assert.ok(result.files.find((file) => file.path === 'python/main.py').symbols.some((symbol) => symbol.name === 'Runner' && symbol.kind === 'class'));
    assert.ok(result.files.find((file) => file.path === 'python/main.py').symbols.some((symbol) => symbol.name === 'run' && symbol.kind === 'function'));
    assert.ok(result.files.find((file) => file.path === 'java/src/com/example/Main.java').symbols.some((symbol) => symbol.name === 'run' && symbol.kind === 'function'));
    assert.ok(result.files.find((file) => file.path === 'go/main.go').symbols.some((symbol) => symbol.name === 'main' && symbol.kind === 'function'));
    assert.ok(result.files.find((file) => file.path === 'scala/App.scala').symbols.some((symbol) => symbol.name === 'run' && symbol.kind === 'function'));
    assert.ok(result.relations.some((relation) => relation.kind === 'imports' && relation.request === './helper' && relation.resolved));
    assert.ok(result.relations.some((relation) => relation.kind === 'imports' && relation.request === 'com.example.Helper' && relation.resolved));
    assert.ok(result.relations.some((relation) => relation.kind === 'imports' && relation.request === 'helper.hpp' && relation.resolved));
    assert.ok(result.relations.some((relation) => relation.kind === 'imports' && relation.request === './helper' && relation.to === 'file:rust/helper.rs' && relation.resolved));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
