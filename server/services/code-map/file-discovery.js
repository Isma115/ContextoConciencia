const fs = require('node:fs');
const path = require('node:path');

const SUPPORTED_EXTENSIONS = new Map([
  ['.js', 'javascript'],
  ['.jsx', 'javascript'],
  ['.ts', 'typescript'],
  ['.tsx', 'typescript'],
  ['.mjs', 'javascript'],
  ['.cjs', 'javascript'],
  ['.py', 'python'],
  ['.pyw', 'python'],
  ['.java', 'java'],
  ['.cs', 'csharp'],
  ['.c', 'c'],
  ['.h', 'c'],
  ['.cc', 'cpp'],
  ['.cpp', 'cpp'],
  ['.cxx', 'cpp'],
  ['.hh', 'cpp'],
  ['.hpp', 'cpp'],
  ['.hxx', 'cpp'],
  ['.go', 'go'],
  ['.rs', 'rust'],
  ['.php', 'php'],
  ['.phtml', 'php'],
  ['.rb', 'ruby'],
  ['.rake', 'ruby'],
  ['.gemspec', 'ruby'],
  ['.kt', 'kotlin'],
  ['.kts', 'kotlin'],
  ['.swift', 'swift'],
  ['.dart', 'dart'],
  ['.lua', 'lua'],
  ['.r', 'r'],
  ['.scala', 'scala'],
  ['.sc', 'scala'],
  ['.pl', 'perl'],
  ['.pm', 'perl'],
  ['.sh', 'shell'],
  ['.bash', 'shell'],
  ['.zsh', 'shell'],
  ['.fish', 'shell'],
  ['.ps1', 'powershell'],
  ['.psm1', 'powershell'],
  ['.sql', 'sql'],
  ['.html', 'html'],
  ['.htm', 'html'],
  ['.css', 'css']
]);

const DEFAULT_EXCLUDED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.cache',
  'cache',
  '.next',
  '.nuxt',
  '.vinext',
  '.vercel',
  '.wrangler',
  '.output',
  '.svelte-kit',
  '.turbo',
  '.parcel-cache',
  '.vite',
  'out',
  'tmp',
  'temp'
]);

const DEFAULT_MAX_FILES = 2000;
const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_DEPTH = 80;
const DEFAULT_MAX_EXCLUDES = 100;

function normaliseRelative(value) {
  return String(value || '').replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+/g, '/');
}

function insideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function compileGlob(pattern) {
  const input = normaliseRelative(pattern).replace(/\/$/, '');
  if (!input) return null;
  let expression = '^';
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === '*' && input[index + 1] === '*') {
      index += 1;
      if (input[index + 1] === '/') {
        index += 1;
        expression += '(?:.*\/)?';
      } else {
        expression += '.*';
      }
    } else if (character === '*') {
      expression += '[^/]*';
    } else if (character === '?') {
      expression += '[^/]';
    } else {
      expression += character.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
    }
  }
  return new RegExp(`${expression}$`);
}

function createExclusionMatcher(patterns = []) {
  const safePatterns = Array.isArray(patterns)
    ? patterns.filter((pattern) => typeof pattern === 'string' && pattern.trim()).slice(0, DEFAULT_MAX_EXCLUDES)
    : [];
  const globs = safePatterns.map(compileGlob).filter(Boolean);
  return (relativePath, entryName, isDirectory) => {
    const relative = normaliseRelative(relativePath);
    if (isDirectory && DEFAULT_EXCLUDED_DIRECTORIES.has(entryName)) return true;
    if (relative.split('/').some((segment) => DEFAULT_EXCLUDED_DIRECTORIES.has(segment))) return true;
    return globs.some((glob) => glob.test(relative) || glob.test(`${relative}/`));
  };
}

function isTextBuffer(buffer) {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8192));
  if (sample.includes(0)) return false;
  let suspicious = 0;
  for (const byte of sample) {
    if (byte < 7 || (byte > 14 && byte < 32)) suspicious += 1;
  }
  return sample.length === 0 || suspicious / sample.length < 0.02;
}

function supportedLanguage(filePath) {
  return SUPPORTED_EXTENSIONS.get(path.extname(filePath).toLowerCase()) || null;
}

function discoverFiles(projectRoot, options = {}) {
  const root = fs.realpathSync(projectRoot);
  const rootStats = fs.statSync(root);
  if (!rootStats.isDirectory()) throw new Error('La raíz del proyecto global debe ser una carpeta');

  const maxFiles = Math.min(Math.max(Number(options.maxFiles) || DEFAULT_MAX_FILES, 1), 10000);
  const maxFileBytes = Math.min(Math.max(Number(options.maxFileBytes) || DEFAULT_MAX_FILE_BYTES, 1024), 20 * 1024 * 1024);
  const maxDepth = Math.min(Math.max(Number(options.maxDepth) || DEFAULT_MAX_DEPTH, 1), 200);
  const shouldExclude = createExclusionMatcher(options.excludes);
  const requestedInputPaths = Array.isArray(options.inputPaths) && options.inputPaths.length
    ? [...new Set(options.inputPaths.filter((value) => typeof value === 'string' && value.trim()).map((value) => path.resolve(value)))]
    : null;
  const inputPaths = requestedInputPaths
    ? requestedInputPaths.map((inputPath) => {
      let realPath;
      try { realPath = fs.realpathSync(inputPath); } catch { throw new Error('Una de las rutas de la fuente seleccionada ya no existe'); }
      if (!insideRoot(root, realPath)) throw new Error('Una de las rutas de la fuente queda fuera de la raíz seleccionada');
      return realPath;
    })
    : null;
  const files = [];
  const warnings = [];
  const visitedDirectories = new Set([root]);
  let truncated = false;

  function isRelevantPath(candidate) {
    if (!inputPaths) return true;
    return inputPaths.some((inputPath) => candidate === inputPath || insideRoot(inputPath, candidate) || insideRoot(candidate, inputPath));
  }

  function isSelectedFile(candidate) {
    return !inputPaths || inputPaths.some((inputPath) => candidate === inputPath || insideRoot(inputPath, candidate));
  }

  function visit(directory, depth) {
    if (truncated || depth > maxDepth) {
      if (depth > maxDepth) warnings.push({ path: relativePath(directory), message: `Se alcanzó la profundidad máxima de ${maxDepth}` });
      return;
    }
    let entries;
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true }).sort((first, second) => first.name.localeCompare(second.name));
    } catch (error) {
      warnings.push({ path: relativePath(directory), message: `No se pudo leer la carpeta: ${error.message}` });
      return;
    }
    for (const entry of entries) {
      if (truncated) return;
      const candidate = path.join(directory, entry.name);
      const relative = relativePath(candidate);
      if (shouldExclude(relative, entry.name, entry.isDirectory())) continue;

      let realCandidate;
      try {
        realCandidate = fs.realpathSync(candidate);
      } catch (error) {
        warnings.push({ path: relative, message: `No se pudo resolver la ruta: ${error.message}` });
        continue;
      }
      if (!insideRoot(root, realCandidate)) {
        warnings.push({ path: relative, message: 'Se omitió una ruta que queda fuera de la raíz del proyecto' });
        continue;
      }
      if (!isRelevantPath(realCandidate)) continue;
      if (!entry.isDirectory() && !isSelectedFile(realCandidate)) continue;

      let stats;
      try { stats = fs.statSync(realCandidate); } catch (error) {
        warnings.push({ path: relative, message: `No se pudo inspeccionar el fichero: ${error.message}` });
        continue;
      }
      if (stats.isDirectory()) {
        if (visitedDirectories.has(realCandidate)) continue;
        visitedDirectories.add(realCandidate);
        visit(realCandidate, depth + 1);
        continue;
      }
      if (!stats.isFile()) continue;
      const language = supportedLanguage(realCandidate);
      if (!language) continue;
      if (stats.size > maxFileBytes) {
        warnings.push({ path: relative, message: `El fichero supera el límite de ${Math.round(maxFileBytes / 1024 / 1024 * 10) / 10} MB` });
        continue;
      }
      try {
        const descriptor = fs.readFileSync(realCandidate);
        if (!isTextBuffer(descriptor)) {
          warnings.push({ path: relative, message: 'Se omitió un fichero binario o con texto no válido' });
          continue;
        }
      } catch (error) {
        warnings.push({ path: relative, message: `No se pudo leer el fichero: ${error.message}` });
        continue;
      }
      if (files.length >= maxFiles) {
        truncated = true;
        warnings.push({ path: relative, message: `Se alcanzó el límite de ${maxFiles} ficheros` });
        return;
      }
      files.push({
        absolutePath: realCandidate,
        path: relative,
        relativePath: relative,
        language,
        extension: path.extname(realCandidate).toLowerCase().slice(1),
        size: stats.size,
        modifiedAt: stats.mtime.toISOString(),
        mtimeMs: stats.mtimeMs
      });
    }
  }

  function relativePath(candidate) {
    return normaliseRelative(path.relative(root, candidate));
  }

  visit(root, 0);
  files.sort((first, second) => first.path.localeCompare(second.path));
  return {
    root,
    files,
    warnings,
    truncated,
    limits: { maxFiles, maxFileBytes, maxDepth },
    excludedDirectories: [...DEFAULT_EXCLUDED_DIRECTORIES].sort()
  };
}

module.exports = {
  SUPPORTED_EXTENSIONS,
  DEFAULT_EXCLUDED_DIRECTORIES,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_FILE_BYTES,
  DEFAULT_MAX_DEPTH,
  createExclusionMatcher,
  discoverFiles,
  insideRoot,
  isTextBuffer,
  normaliseRelative,
  supportedLanguage
};
