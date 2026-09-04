const DEFAULT_MAX_ENTRIES = 2000;
const DEFAULT_MAX_SEARCH_RESULTS = 500;
const DEFAULT_MAX_SEARCH_VISITED = 20000;
const MAX_OPERATION_ENTRIES = 100;
const MAX_NAME_LENGTH = 255;

function createFileExplorerService({ app, fs, path, shell }) {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  function normaliseAbsolutePath(value, invalidMessage = 'La ruta no es válida') {
    if (typeof value !== 'string' || !value.trim() || !path.isAbsolute(value)) {
      throw new Error(invalidMessage);
    }
    return path.normalize(value);
  }

  function pathKey(value) {
    const normalised = path.normalize(value);
    return process.platform === 'win32' ? normalised.toLocaleLowerCase() : normalised;
  }

  function isSamePath(first, second) {
    return pathKey(first) === pathKey(second);
  }

  function isPathInside(parentPath, candidatePath) {
    const relative = path.relative(parentPath, candidatePath);
    return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
  }

  function isFilesystemRoot(value) {
    const normalised = path.normalize(value);
    return pathKey(path.parse(normalised).root) === pathKey(normalised);
  }

  function readableError(error, fallback) {
    if (error?.code === 'EACCES' || error?.code === 'EPERM') return new Error('No tienes permiso para modificar esta ubicación');
    if (error?.code === 'ENOSPC') return new Error('No queda espacio disponible en esta unidad');
    if (error?.code === 'ENOTEMPTY' || error?.code === 'EBUSY') return new Error('La ubicación está siendo utilizada');
    if (error?.code === 'EEXIST') return new Error('Ya existe un elemento con ese nombre');
    if (error?.code === 'ENOENT') return new Error('El elemento ya no existe');
    return new Error(fallback);
  }

  function validateEntryName(value) {
    if (typeof value !== 'string') throw new Error('El nombre no es válido');
    const name = value.trim();
    if (!name) throw new Error('Escribe un nombre');
    if (name === '.' || name === '..' || name.includes('/') || name.includes('\\') || name.includes('\0')) {
      throw new Error('El nombre contiene caracteres no válidos');
    }
    if (name.length > MAX_NAME_LENGTH) throw new Error('El nombre es demasiado largo');
    if (process.platform === 'win32' && /[. ]$/.test(name)) {
      throw new Error('El nombre no puede terminar en punto o espacio');
    }
    return name;
  }

  function fileSystemRoots(additionalRoots = []) {
    const roots = [];
    const seen = new Set();
    const addRoot = (candidate, label, kind = 'shortcut', sourceId = '') => {
      if (typeof candidate !== 'string' || !candidate.trim()) return;
      const normalized = path.normalize(candidate);
      const key = pathKey(normalized);
      if (seen.has(key)) return;
      try {
        if (!fs.statSync(normalized).isDirectory()) return;
      } catch {
        return;
      }
      seen.add(key);
      roots.push({ path: normalized, label, kind, ...(sourceId ? { sourceId } : {}) });
    };

    (Array.isArray(additionalRoots) ? additionalRoots : []).forEach((root) => {
      if (!root || typeof root !== 'object') return;
      const label = typeof root.label === 'string' && root.label.trim() ? root.label.trim() : 'Fuente local';
      const sourceId = typeof root.sourceId === 'string' ? root.sourceId : '';
      addRoot(root.path, label, 'source', sourceId);
    });

    addRoot(app.getPath('home'), 'Inicio');
    [
      ['desktop', 'Escritorio'],
      ['documents', 'Documentos'],
      ['downloads', 'Descargas'],
      ['pictures', 'Imágenes'],
      ['videos', 'Vídeos'],
      ['music', 'Música']
    ].forEach(([name, label]) => addRoot(app.getPath(name), label));

    if (process.platform === 'win32') {
      for (let code = 65; code <= 90; code += 1) {
        const letter = String.fromCharCode(code);
        addRoot(`${letter}:\\`, `Unidad ${letter}:`, 'drive');
      }
    } else {
      addRoot(path.parse(app.getPath('home')).root, 'Sistema', 'drive');
    }
    return roots;
  }

  function existingDirectory(directoryPath) {
    const requestedPath = normaliseAbsolutePath(directoryPath, 'La ruta de la carpeta no es válida');
    let resolvedPath;
    try {
      resolvedPath = fs.realpathSync(requestedPath);
      if (!fs.statSync(resolvedPath).isDirectory()) throw new Error('La ubicación seleccionada no es una carpeta');
    } catch (error) {
      if (error.message === 'La ubicación seleccionada no es una carpeta') throw error;
      throw new Error('La carpeta no existe o no se puede leer');
    }
    return resolvedPath;
  }

  function existingEntry(entryPath) {
    const normalised = normaliseAbsolutePath(entryPath, 'La ruta del elemento no es válida');
    let stats;
    try {
      stats = fs.lstatSync(normalised);
    } catch {
      throw new Error('El elemento ya no existe');
    }
    return { path: normalised, stats };
  }

  async function entryMetadata(parentPath, directoryEntry) {
    const entryPath = path.join(parentPath, directoryEntry.name);
    let linkStats;
    try {
      linkStats = await fs.promises.lstat(entryPath);
    } catch {
      return null;
    }
    let targetStats = linkStats;
    if (linkStats.isSymbolicLink()) {
      try {
        targetStats = await fs.promises.stat(entryPath);
      } catch {
        targetStats = null;
      }
    }
    const isDirectory = Boolean(targetStats?.isDirectory());
    const isFile = Boolean(targetStats?.isFile());
    const isLink = linkStats.isSymbolicLink() && !isDirectory && !isFile;
    return {
      name: directoryEntry.name,
      path: entryPath,
      kind: isDirectory ? 'directory' : isLink ? 'link' : 'file',
      extension: isFile ? path.extname(directoryEntry.name).slice(1).toLowerCase() : '',
      size: isFile ? targetStats.size : null,
      modifiedAt: targetStats?.mtime?.toISOString() || null,
      hidden: directoryEntry.name.startsWith('.'),
      isSymbolicLink: linkStats.isSymbolicLink()
    };
  }

  async function readDirectory(directoryPath) {
    try {
      return await fs.promises.readdir(directoryPath, { withFileTypes: true });
    } catch (error) {
      throw readableError(error, 'No se puede leer esta carpeta');
    }
  }

  async function listDirectory(directoryPath) {
    const normalized = existingDirectory(directoryPath);
    const directoryEntries = await readDirectory(normalized);
    const truncated = directoryEntries.length > DEFAULT_MAX_ENTRIES;
    const entries = (await Promise.all(directoryEntries.slice(0, DEFAULT_MAX_ENTRIES).map((entry) => entryMetadata(normalized, entry))))
      .filter(Boolean);
    entries.sort((first, second) => {
      const firstDirectory = first.kind === 'directory' ? 0 : 1;
      const secondDirectory = second.kind === 'directory' ? 0 : 1;
      return firstDirectory - secondDirectory || collator.compare(first.name, second.name);
    });
    return {
      path: normalized,
      parentPath: path.dirname(normalized),
      entries,
      total: directoryEntries.length,
      truncated
    };
  }

  async function searchDirectory(payload = {}) {
    const normalized = existingDirectory(payload.directoryPath);
    const query = String(payload.query || '').trim().toLocaleLowerCase();
    if (!query) throw new Error('Escribe un término para buscar');
    const includeHidden = payload.includeHidden === true;
    const entries = [];
    let visited = 0;
    let truncated = false;

    async function visit(currentPath, relativeBase = '') {
      if (truncated) return;
      let directoryEntries;
      try {
        directoryEntries = await readDirectory(currentPath);
      } catch (error) {
        if (isSamePath(currentPath, normalized)) throw error;
        return;
      }
      directoryEntries.sort((first, second) => {
        const firstDirectory = first.isDirectory() ? 0 : 1;
        const secondDirectory = second.isDirectory() ? 0 : 1;
        return firstDirectory - secondDirectory || collator.compare(first.name, second.name);
      });
      for (const directoryEntry of directoryEntries) {
        if (!includeHidden && directoryEntry.name.startsWith('.')) continue;
        visited += 1;
        if (visited > DEFAULT_MAX_SEARCH_VISITED) {
          truncated = true;
          return;
        }
        const metadata = await entryMetadata(currentPath, directoryEntry);
        if (!metadata) continue;
        const relativePath = path.join(relativeBase, metadata.name);
        metadata.relativePath = relativePath;
        if (metadata.name.toLocaleLowerCase().includes(query) || relativePath.toLocaleLowerCase().includes(query)) {
          entries.push(metadata);
          if (entries.length >= DEFAULT_MAX_SEARCH_RESULTS) {
            truncated = true;
            return;
          }
        }
        if (metadata.kind === 'directory' && !metadata.isSymbolicLink) {
          await visit(metadata.path, relativePath);
          if (truncated) return;
        }
      }
    }

    await visit(normalized);
    return {
      path: normalized,
      parentPath: path.dirname(normalized),
      entries,
      total: entries.length,
      truncated
    };
  }

  async function openEntry(entryPath) {
    const { path: normalized } = existingEntry(entryPath);
    let resolvedPath;
    try {
      resolvedPath = fs.realpathSync(normalized);
      if (!fs.statSync(resolvedPath).isFile()) throw new Error('La ubicación seleccionada no es un fichero');
    } catch (error) {
      if (error.message === 'La ubicación seleccionada no es un fichero') throw error;
      throw new Error('El fichero no existe o no se puede abrir');
    }
    const errorMessage = await shell.openPath(resolvedPath);
    if (errorMessage) throw new Error(errorMessage);
    return { ok: true };
  }

  function revealEntry(entryPath) {
    const { path: normalized } = existingEntry(entryPath);
    shell.showItemInFolder(normalized);
    return { ok: true };
  }

  async function createDirectory(payload = {}) {
    const parentPath = existingDirectory(payload.parentPath);
    const name = validateEntryName(payload.name);
    const targetPath = path.join(parentPath, name);
    try {
      await fs.promises.mkdir(targetPath);
    } catch (error) {
      throw readableError(error, 'No se pudo crear la carpeta');
    }
    return { path: targetPath, name, kind: 'directory' };
  }

  async function createFile(payload = {}) {
    const parentPath = existingDirectory(payload.parentPath);
    const name = validateEntryName(payload.name);
    const targetPath = path.join(parentPath, name);
    try {
      await fs.promises.writeFile(targetPath, '', { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    } catch (error) {
      throw readableError(error, 'No se pudo crear el fichero');
    }
    return { path: targetPath, name, kind: 'file' };
  }

  async function renameEntry(payload = {}) {
    const source = existingEntry(payload.path);
    if (isFilesystemRoot(source.path)) throw new Error('No se puede renombrar una unidad');
    const name = validateEntryName(payload.name);
    const targetPath = path.join(path.dirname(source.path), name);
    if (isSamePath(source.path, targetPath)) return { path: source.path, name };
    try {
      await fs.promises.access(targetPath);
      throw new Error('Ya existe un elemento con ese nombre');
    } catch (error) {
      if (error.message === 'Ya existe un elemento con ese nombre') throw error;
      if (error.code !== 'ENOENT') throw readableError(error, 'No se pudo comprobar el nuevo nombre');
    }
    try {
      await fs.promises.rename(source.path, targetPath);
    } catch (error) {
      throw readableError(error, 'No se pudo renombrar el elemento');
    }
    return { path: targetPath, name };
  }

  function normaliseOperationPaths(value) {
    if (!Array.isArray(value) || !value.length || value.length > MAX_OPERATION_ENTRIES) {
      throw new Error(`Selecciona entre 1 y ${MAX_OPERATION_ENTRIES} elementos`);
    }
    const unique = [];
    const keys = new Set();
    value.forEach((entryPath) => {
      const normalized = normaliseAbsolutePath(entryPath, 'Una de las rutas no es válida');
      const key = pathKey(normalized);
      if (!keys.has(key)) {
        keys.add(key);
        unique.push(normalized);
      }
    });
    return unique;
  }

  function removeNestedPaths(paths) {
    return paths
      .slice()
      .sort((first, second) => first.length - second.length)
      .filter((candidate, index, sorted) => !sorted.slice(0, index).some((parent) => isPathInside(parent, candidate)));
  }

  async function deleteEntries(payload = []) {
    const paths = normaliseOperationPaths(Array.isArray(payload) ? payload : payload.paths);
    const candidates = removeNestedPaths(paths);
    candidates.forEach((entryPath) => {
      if (isFilesystemRoot(entryPath)) throw new Error('No se puede eliminar una unidad completa');
    });
    for (const entryPath of candidates) {
      const { stats } = existingEntry(entryPath);
      try {
        await fs.promises.rm(entryPath, { recursive: stats.isDirectory() && !stats.isSymbolicLink(), force: false });
      } catch (error) {
        throw readableError(error, 'No se pudo eliminar el elemento');
      }
    }
    return { deleted: candidates };
  }

  function uniqueDestinationPath(destinationPath, sourceName, reserved) {
    const extension = path.extname(sourceName);
    const stem = extension ? sourceName.slice(0, -extension.length) : sourceName;
    let candidate = path.join(destinationPath, sourceName);
    let suffix = 1;
    while (reserved.has(pathKey(candidate)) || fs.existsSync(candidate)) {
      suffix += 1;
      const copyLabel = suffix === 2 ? ' (copia)' : ` (copia ${suffix - 1})`;
      candidate = path.join(destinationPath, `${stem}${copyLabel}${extension}`);
    }
    reserved.add(pathKey(candidate));
    return candidate;
  }

  async function transferEntries(payload = {}) {
    const sourcePaths = normaliseOperationPaths(payload.sourcePaths);
    const destinationPath = existingDirectory(payload.destinationPath);
    const operation = payload.operation === 'cut' ? 'cut' : payload.operation === 'copy' ? 'copy' : '';
    if (!operation) throw new Error('La operación de portapapeles no es válida');
    const candidates = removeNestedPaths(sourcePaths);
    const sourceEntries = candidates.map((sourcePath) => existingEntry(sourcePath));
    sourceEntries.forEach(({ path: sourcePath, stats }) => {
      if (isFilesystemRoot(sourcePath)) throw new Error('No se puede mover una unidad completa');
      if (stats.isDirectory() && isPathInside(sourcePath, destinationPath)) {
        throw new Error('No se puede pegar una carpeta dentro de sí misma');
      }
    });
    const reserved = new Set();
    const transferred = [];
    for (const source of sourceEntries) {
      const targetPath = operation === 'cut' && isSamePath(path.dirname(source.path), destinationPath)
        ? source.path
        : uniqueDestinationPath(destinationPath, path.basename(source.path), reserved);
      if (isSamePath(source.path, targetPath)) {
        transferred.push(targetPath);
        continue;
      }
      try {
        if (operation === 'copy') {
          await fs.promises.cp(source.path, targetPath, {
            recursive: source.stats.isDirectory() && !source.stats.isSymbolicLink(),
            force: false,
            errorOnExist: true,
            dereference: false
          });
        } else {
          try {
            await fs.promises.rename(source.path, targetPath);
          } catch (error) {
            if (error.code !== 'EXDEV') throw error;
            await fs.promises.cp(source.path, targetPath, {
              recursive: source.stats.isDirectory() && !source.stats.isSymbolicLink(),
              force: false,
              errorOnExist: true,
              dereference: false
            });
            await fs.promises.rm(source.path, { recursive: source.stats.isDirectory() && !source.stats.isSymbolicLink(), force: false });
          }
        }
      } catch (error) {
        throw readableError(error, operation === 'copy' ? 'No se pudo copiar el elemento' : 'No se pudo mover el elemento');
      }
      transferred.push(targetPath);
    }
    return { operation, entries: transferred };
  }

  return {
    getRoots: fileSystemRoots,
    listDirectory,
    searchDirectory,
    openEntry,
    revealEntry,
    createDirectory,
    createFile,
    renameEntry,
    deleteEntries,
    transferEntries
  };
}

module.exports = { createFileExplorerService };
