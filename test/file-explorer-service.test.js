const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { createFileExplorerService } = require('../desktop/file-explorer-service');

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexusdata-file-explorer-'));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'main.js'), 'console.log("ok");');
  fs.writeFileSync(path.join(root, 'notes.txt'), 'notas');
  return root;
}

function createService(root) {
  return createFileExplorerService({
    app: { getPath: () => root },
    fs,
    path,
    shell: { openPath: async () => '' }
  });
}

test('separa las operaciones de navegación, búsqueda y creación del explorador', async () => {
  const root = createFixture();
  try {
    const service = createService(root);
    const directory = await service.listDirectory(root);
    assert.deepEqual(directory.entries.map((entry) => entry.name), ['src', 'notes.txt']);

    const search = await service.searchDirectory({ directoryPath: root, query: 'main' });
    assert.deepEqual(search.entries.map((entry) => entry.relativePath), [path.join('src', 'main.js')]);

    await service.createDirectory({ parentPath: root, name: 'docs' });
    await service.createFile({ parentPath: path.join(root, 'docs'), name: 'readme.md' });
    await service.renameEntry({ path: path.join(root, 'docs', 'readme.md'), name: 'README.md' });
    assert.equal(fs.existsSync(path.join(root, 'docs', 'README.md')), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('solo expone como accesos directos configurados las rutas que son carpetas', () => {
  const root = createFixture();
  try {
    const service = createService(root);
    const sourceDirectory = path.join(root, 'src');
    const sourceFile = path.join(root, 'notes.txt');
    const roots = service.getRoots([
      { path: sourceDirectory, label: 'Documentación', kind: 'source', sourceId: 'source-1' },
      { path: sourceFile, label: 'Notas', kind: 'source', sourceId: 'source-1' }
    ]);

    assert.deepEqual(
      roots.filter((entry) => entry.sourceId === 'source-1'),
      [{ path: sourceDirectory, label: 'Documentación', kind: 'source', sourceId: 'source-1' }]
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('copia, mueve y elimina sin permitir operaciones peligrosas sobre una carpeta padre', async () => {
  const root = createFixture();
  try {
    const service = createService(root);
    const source = path.join(root, 'src', 'main.js');
    await service.transferEntries({ sourcePaths: [source], destinationPath: root, operation: 'copy' });
    assert.equal(fs.existsSync(path.join(root, 'main.js')), true);

    await service.createDirectory({ parentPath: root, name: 'moved' });
    await service.transferEntries({ sourcePaths: [path.join(root, 'notes.txt')], destinationPath: path.join(root, 'moved'), operation: 'cut' });
    assert.equal(fs.existsSync(path.join(root, 'moved', 'notes.txt')), true);

    await service.deleteEntries([path.join(root, 'main.js'), path.join(root, 'moved')]);
    assert.equal(fs.existsSync(path.join(root, 'main.js')), false);
    assert.equal(fs.existsSync(path.join(root, 'moved')), false);
    await assert.rejects(() => service.deleteEntries([path.parse(root).root]), /unidad completa/i);
    await assert.rejects(() => service.transferEntries({ sourcePaths: [path.join(root, 'src')], destinationPath: path.join(root, 'src'), operation: 'copy' }), /sí misma/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
