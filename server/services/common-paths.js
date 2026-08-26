const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const COMMON_DIRECTORY_DEFINITIONS = Object.freeze([
  Object.freeze({ key: 'documents', label: 'Documentos', candidates: ['Documents', 'Documentos'] }),
  Object.freeze({ key: 'downloads', label: 'Descargas', candidates: ['Downloads', 'Descargas'] }),
  Object.freeze({ key: 'pictures', label: 'Imágenes', candidates: ['Pictures', 'Imágenes', 'Imagenes'] }),
  Object.freeze({ key: 'desktop', label: 'Escritorio', candidates: ['Desktop', 'Escritorio'] }),
  Object.freeze({ key: 'videos', label: 'Películas / Vídeos', candidates: ['Movies', 'Videos', 'Vídeos', 'Películas'] }),
  Object.freeze({ key: 'music', label: 'Música', candidates: ['Music', 'Música', 'Musica'] }),
  Object.freeze({ key: 'public', label: 'Público', candidates: ['Public', 'Público', 'Publico'] }),
  Object.freeze({ key: 'projects', label: 'Proyectos', candidates: ['Projects', 'Proyectos', 'Developer', 'Desarrollo'] }),
  Object.freeze({ key: 'code', label: 'Código', candidates: ['Code', 'Código', 'Codigo', 'Workspace', 'Workspaces'] })
]);

const COMMON_SCAN_EXCLUDED_DIRECTORIES = Object.freeze([
  '.git',
  '.hg',
  '.svn',
  '.idea',
  '.vscode',
  'node_modules',
  'vendor',
  'target',
  'dist',
  'build',
  'coverage',
  '__pycache__'
]);

const COMMON_PATHS_ROLE = 'common-paths';
const COMMON_PATHS_SOURCE_NAME = 'Rutas comunes';

function pathKey(value) {
  const normalised = path.normalize(value);
  return process.platform === 'win32' ? normalised.toLowerCase() : normalised;
}

function resolvedDirectory(candidate, fsModule) {
  try {
    if (!fsModule.statSync(candidate).isDirectory()) return null;
    return typeof fsModule.realpathSync === 'function' ? fsModule.realpathSync(candidate) : candidate;
  } catch {
    return null;
  }
}

function listCommonDirectories({ homeDirectory = os.homedir(), fsModule = fs } = {}) {
  const home = path.resolve(homeDirectory);
  const seen = new Set();
  const directories = [];

  for (const definition of COMMON_DIRECTORY_DEFINITIONS) {
    for (const candidateName of definition.candidates) {
      const candidate = path.join(home, candidateName);
      const directory = resolvedDirectory(candidate, fsModule);
      if (!directory) continue;
      const key = pathKey(directory);
      if (seen.has(key)) continue;
      seen.add(key);
      directories.push({
        key: definition.key,
        label: definition.label,
        name: candidateName,
        path: directory
      });
    }
  }

  return directories;
}

function commonPathsConfig(directories) {
  const entries = Array.isArray(directories) ? directories : [];
  return {
    role: COMMON_PATHS_ROLE,
    paths: entries.map((directory) => directory.path),
    directories: entries.map(({ key, label, name, path: directoryPath }) => ({ key, label, name, path: directoryPath })),
    excludeDirectories: [...COMMON_SCAN_EXCLUDED_DIRECTORIES],
    ignoreErrors: true,
    followSymlinks: false
  };
}

function isCommonPathsConfig(config) {
  return config && config.role === COMMON_PATHS_ROLE;
}

module.exports = {
  COMMON_DIRECTORY_DEFINITIONS,
  COMMON_SCAN_EXCLUDED_DIRECTORIES,
  COMMON_PATHS_ROLE,
  COMMON_PATHS_SOURCE_NAME,
  commonPathsConfig,
  isCommonPathsConfig,
  listCommonDirectories
};
