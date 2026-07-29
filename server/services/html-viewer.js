const fs = require('node:fs');
const path = require('node:path');
const { SUPPORTED, MAX_FILE_BYTES, MAX_FILES } = require('../importers/local');

const MAX_PROJECT_BYTES = 20 * 1024 * 1024;
const MAX_INPUT_PATHS = 50;
const WEB_TYPES = new Set(['html', 'css', 'javascript']);

function collectWebFiles(inputPath, files = []) {
  if (files.length >= MAX_FILES) return files;
  const absolute = path.resolve(inputPath);
  const stats = fs.lstatSync(absolute);
  if (stats.isSymbolicLink()) return files;
  if (stats.isFile()) {
    const type = SUPPORTED.get(path.extname(absolute).toLowerCase());
    if (WEB_TYPES.has(type)) files.push(absolute);
    return files;
  }
  if (!stats.isDirectory()) return files;
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    collectWebFiles(path.join(absolute, entry.name), files);
    if (files.length >= MAX_FILES) break;
  }
  return files;
}

function normaliseInputPaths(paths) {
  if (!Array.isArray(paths)) throw new Error('Selecciona al menos un archivo o carpeta');
  const unique = [...new Set(paths.filter((value) => typeof value === 'string' && value.trim()).map((value) => path.resolve(value)))];
  if (!unique.length) throw new Error('Selecciona al menos un archivo o carpeta');
  if (unique.length > MAX_INPUT_PATHS) throw new Error(`Puedes seleccionar como máximo ${MAX_INPUT_PATHS} rutas`);
  return unique;
}

function commonRoot(paths) {
  const directories = paths.map((inputPath) => {
    try { return fs.statSync(inputPath).isDirectory() ? inputPath : path.dirname(inputPath); } catch { return path.dirname(inputPath); }
  });
  let root = directories[0] || process.cwd();
  while (root && !directories.every((directory) => directory === root || directory.startsWith(`${root}${path.sep}`))) {
    const parent = path.dirname(root);
    if (parent === root) break;
    root = parent;
  }
  return root;
}

function relativePath(root, filePath) {
  const value = path.relative(root, filePath).split(path.sep).join('/');
  return value || path.basename(filePath);
}

function inspectHtmlProject(inputPaths) {
  const paths = normaliseInputPaths(inputPaths);
  const files = [];
  const errors = [];
  for (const inputPath of paths) {
    try {
      if (!fs.existsSync(inputPath)) throw new Error('La ruta no existe');
      collectWebFiles(inputPath, files);
    } catch (error) {
      errors.push({ path: inputPath, message: error.message });
    }
  }

  const uniqueFiles = [...new Set(files)];
  if (!uniqueFiles.length) {
    const detail = errors[0]?.message ? ` (${errors[0].message})` : '';
    throw new Error(`No se encontraron archivos HTML, CSS o JavaScript${detail}`);
  }
  const root = commonRoot(paths);
  let totalBytes = 0;
  const projectFiles = [];
  for (const filePath of uniqueFiles.slice(0, MAX_FILES)) {
    const extension = path.extname(filePath).toLowerCase();
    const type = SUPPORTED.get(extension);
    try {
      const stats = fs.statSync(filePath);
      if (stats.size > MAX_FILE_BYTES) throw new Error(`El archivo supera el límite de ${MAX_FILE_BYTES / 1024 / 1024} MB`);
      totalBytes += stats.size;
      if (totalBytes > MAX_PROJECT_BYTES) throw new Error(`El conjunto supera el límite de ${MAX_PROJECT_BYTES / 1024 / 1024} MB`);
      projectFiles.push({
        path: filePath,
        relativePath: relativePath(root, filePath),
        name: path.basename(filePath),
        extension: extension.slice(1),
        type,
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
        content: fs.readFileSync(filePath, 'utf8')
      });
    } catch (error) {
      errors.push({ path: filePath, message: error.message });
    }
  }
  if (!projectFiles.length) throw new Error('No se pudieron leer los archivos seleccionados');
  projectFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'es'));
  const htmlFiles = projectFiles.filter((file) => file.type === 'html');
  const entry = htmlFiles.find((file) => /(^|\/)index\.html?$/i.test(file.relativePath)) || htmlFiles[0] || null;
  let name = path.basename(root) || 'Proyecto HTML';
  if (paths.length === 1) {
    try {
      if (fs.statSync(paths[0]).isFile()) name = path.basename(paths[0]);
    } catch { /* La lectura del archivo ya queda reflejada en errors. */ }
  }
  return {
    name,
    root,
    paths,
    entry: entry?.relativePath || null,
    files: projectFiles,
    errors,
    totalBytes
  };
}

module.exports = { inspectHtmlProject, MAX_PROJECT_BYTES, MAX_INPUT_PATHS };
