const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');
const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const { startServer } = require('../server/app');
const { createFileExplorerService } = require('./file-explorer-service');
const { detectFileType } = require('../server/services/media-detection');

let apiServer;
const HTML_VIEW_MENU_NAME = 'Archivo';
const EDIT_MENU_NAME = 'Edición';
const DIAGRAM_MENU_NAME = 'Diagramas';
const PROJECT_MENU_NAME = 'Proyecto';
const SPECS_MENU_NAME = 'Specs';
const PREFERENCES_MENU_NAME = 'Preferencias';
const EXPORT_MENU_NAME = 'Espacio';
const PROMPTS_MENU_NAME = 'Prompts';
const SEARCH_PREFERENCES_FILENAME = 'search-preferences.json';
const SDD_LAST_PROJECT_FILENAME = 'sdd-last-project.json';
const LAST_VIEW_FILENAME = 'last-view.json';
const DEFAULT_VIEW = 'global-search';
const AVAILABLE_VIEWS = new Set([
  'global-search',
  'search',
  'recent-documents',
  'favorites',
  'html-viewer',
  'diagrams',
  'code-map',
  'sources',
  'file-explorer',
  'prompt-config',
  'sdd-home',
  'sdd-specs',
  'sdd-database',
  'sdd-resources',
  'sdd-terminal'
]);
const DIAGRAM_MAX_FILE_BYTES = 2 * 1024 * 1024;
const DIAGRAM_MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const WORKSPACE_MAX_FILE_BYTES = 50 * 1024 * 1024;
const DESKTOP_PORT = Number(process.env.PORT) || 3000;
const OFFLINE_ONLY = true;
const SDD_MEDIA_MIME_BY_EXTENSION = Object.freeze({
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  avif: 'image/avif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
  mp3: 'audio/mpeg',
  mpga: 'audio/mpeg',
  wav: 'audio/wav',
  wave: 'audio/wav',
  oga: 'audio/ogg',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  m4a: 'audio/mp4',
  m4b: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
  weba: 'audio/webm',
  wma: 'audio/x-ms-wma',
  aiff: 'audio/aiff',
  aif: 'audio/aiff',
  aifc: 'audio/aiff',
  au: 'audio/basic',
  snd: 'audio/basic',
  amr: 'audio/amr',
  '3gp': 'audio/3gpp',
  caf: 'audio/x-caf',
  mka: 'audio/x-matroska',
  mp2: 'audio/mpeg',
  mpa: 'audio/mpeg',
  ac3: 'audio/ac3',
  dts: 'audio/vnd.dts',
  eac3: 'audio/eac3',
  gsm: 'audio/gsm',
  ra: 'audio/x-realaudio',
  ram: 'audio/x-pn-realaudio',
  voc: 'audio/x-voc',
  ape: 'audio/x-ape',
  wv: 'audio/wavpack',
  tta: 'audio/x-tta',
  dsf: 'audio/x-dsf',
  dff: 'audio/x-dff',
  mid: 'audio/midi',
  midi: 'audio/midi',
  kar: 'audio/midi'
});
const closeConfirmationStates = new WeakMap();
const applicationMenuViews = new WeakMap();
const applicationMenuPromptItems = new WeakMap();
const piProcesses = new WeakMap();
const fileExplorerService = createFileExplorerService({ app, fs, path, shell });

// Evita un destello blanco y cierres del proceso GPU en equipos Windows sin
// un proceso de composición acelerado disponible.
app.disableHardwareAcceleration();
const SDD_SPECS_RESOURCES_DIR = 'specs_resources';
// La estructura S.D.D. se guarda siempre bajo <proyecto>/SDD_specs.
// El diseño anterior, con specs.md en la raíz, ya no se carga ni se crea.
const SDD_SPECS_DIR = 'SDD_specs';
const SDD_SPECS_VERSIONS_DIR = 'specs';
const SDD_DATABASE_FILENAME = 'bbdd.md';
const SDD_FULL_FILENAME = 'specs_full.md';
const SDD_SPECS_RESOURCES_MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const SDD_SPECS_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const SDD_SPECS_VIDEO_MAX_BYTES = 100 * 1024 * 1024;
const SDD_SPECS_AUDIO_MAX_BYTES = 100 * 1024 * 1024;
const SDD_SPECS_SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'build', 'out', 'coverage']);
const PI_DEFAULT_PROVIDER = 'deepseek';
const PI_DEFAULT_MODEL = 'deepseek-flash';
const PI_DEFAULT_THINKING = 'max';
const PI_THINKING_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
const PI_MAX_PROMPT_BYTES = 200 * 1024;
const PI_MAX_MESSAGE_BYTES = 100 * 1024;
const PI_MAX_OUTPUT_BYTES = 10 * 1024 * 1024;
// Evita saturar IPC y el DOM con un mensaje por cada delta del modelo.
const PI_OUTPUT_FLUSH_INTERVAL_MS = 10_000;
const PI_OUTPUT_FLUSH_MIN_INTERVAL_MS = 1_000;
const PI_OUTPUT_FLUSH_MAX_INTERVAL_MS = 3_600_000;
const PI_CATALOG_PROVIDERS = Object.freeze([
  {
    id: 'deepseek',
    label: 'DeepSeek',
    authentication: 'api_key',
    fallbackModels: [
      { id: 'deepseek-flash', name: 'DeepSeek V4.1 Flash', reasoning: true },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', reasoning: true }
    ]
  },
  {
    id: 'openai-codex',
    label: 'Codex (suscripción)',
    authentication: 'subscription',
    fallbackModels: [
      { id: 'gpt-5.3-codex-spark', name: 'GPT-5.3 Codex Spark', reasoning: true },
      { id: 'gpt-5.4', name: 'GPT-5.4', reasoning: true },
      { id: 'gpt-5.4-mini', name: 'GPT-5.4 Mini', reasoning: true },
      { id: 'gpt-5.5', name: 'GPT-5.5', reasoning: true },
      { id: 'gpt-5.6-luna', name: 'GPT-5.6 Luna', reasoning: true },
      { id: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', reasoning: true },
      { id: 'gpt-5.6-terra', name: 'GPT-5.6 Terra', reasoning: true },
      { id: 'gpt-6-astra', name: 'GPT-6 Astra', reasoning: true }
    ]
  }
]);

function readPiJsonFile(filePath) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function piAgentDirectory() {
  const configured = String(process.env.PI_CODING_AGENT_DIR || '').trim();
  return configured ? path.resolve(configured) : path.join(os.homedir(), '.pi', 'agent');
}

function readPiCliModelIds() {
  return new Promise((resolve) => {
    let output = '';
    let settled = false;
    let timeout = null;
    const finish = (models = []) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve(models);
    };
    let child;
    try {
      child = spawn(piCommand(), ['--offline', '--list-models'], {
        env: piEnvironment(),
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true
      });
    } catch {
      finish();
      return;
    }
    timeout = setTimeout(() => {
      try { child.kill(process.platform === 'win32' ? undefined : 'SIGTERM'); } catch { /* El proceso ya terminó. */ }
      finish();
    }, 15_000);
    timeout.unref?.();
    child.stdout?.on('data', (data) => {
      if (output.length < 1024 * 1024) output += data.toString('utf8');
    });
    child.once('error', () => finish());
    child.once('close', () => {
      const providerIds = new Set(PI_CATALOG_PROVIDERS.map((provider) => provider.id));
      const models = Object.fromEntries([...providerIds].map((providerId) => [providerId, []]));
      output.split(/\r?\n/).map((line) => line.trim().split(/\s+/)).forEach((columns) => {
        if (!providerIds.has(columns[0]) || !/^[A-Za-z0-9._:*?+\-/]{1,180}$/.test(columns[1] || '')) return;
        if (!models[columns[0]].includes(columns[1])) models[columns[0]].push(columns[1]);
      });
      finish(models);
    });
  });
}

async function piModelCatalog() {
  const agentDirectory = piAgentDirectory();
  const modelStore = readPiJsonFile(path.join(agentDirectory, 'models-store.json'));
  const authStore = readPiJsonFile(path.join(agentDirectory, 'auth.json'));
  const cliModelIds = await readPiCliModelIds();
  return {
    providers: PI_CATALOG_PROVIDERS.map((provider) => {
      const storedModels = Array.isArray(modelStore[provider.id]?.models) ? modelStore[provider.id].models : [];
      const knownModels = [...provider.fallbackModels, ...storedModels.map((model) => ({
        id: String(model?.id || '').trim(),
        name: String(model?.name || model?.id || '').trim(),
        reasoning: model?.reasoning === true
      }))].filter((model) => /^[A-Za-z0-9._:*?+\-/]{1,180}$/.test(model.id));
      const knownById = new Map(knownModels.map((model) => [model.id, model]));
      const providerCliModelIds = Array.isArray(cliModelIds[provider.id]) ? cliModelIds[provider.id] : [];
      const selectedIds = providerCliModelIds.length
        ? providerCliModelIds
        : storedModels.map((model) => String(model?.id || '').trim()).filter(Boolean);
      const models = (selectedIds.length ? selectedIds : provider.fallbackModels.map((model) => model.id))
        .map((id) => knownById.get(id) || { id, name: id, reasoning: true });
      const environmentAuthenticated = provider.id === 'deepseek' && Boolean(process.env.DEEPSEEK_API_KEY);
      return {
        id: provider.id,
        label: provider.label,
        authentication: provider.authentication,
        authenticated: Boolean(authStore[provider.id]) || environmentAuthenticated,
        models: models.length ? models : provider.fallbackModels
      };
    })
  };
}

function piReadableValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((item) => piReadableValue(item)).join('');
  if (typeof value !== 'object') return String(value);
  if (typeof value.text === 'string') return value.text;
  if (Object.prototype.hasOwnProperty.call(value, 'content')) return piReadableValue(value.content);
  if (Object.prototype.hasOwnProperty.call(value, 'output')) return piReadableValue(value.output);
  if (typeof value.stdout === 'string' || typeof value.stderr === 'string') {
    return [value.stdout, value.stderr].filter(Boolean).join('');
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function piJsonEventText(event) {
  if (!event || typeof event !== 'object') return '';
  if (event.type === 'response' && ['prompt', 'follow_up'].includes(event.command) && event.success === false) {
    return `\n[Pi rechazó el mensaje: ${event.error || 'error desconocido'}]\n`;
  }
  if (event.type === 'message_update') {
    const messageEvent = event.assistantMessageEvent;
    if (!messageEvent) return '';
    if (messageEvent.type === 'text_delta' || messageEvent.type === 'thinking_delta') {
      return String(messageEvent.delta || '');
    }
    if (messageEvent.type === 'toolcall_start') {
      return `\n\n[Pi preparando ${messageEvent.toolName || 'una herramienta'}]\n`;
    }
    return '';
  }
  if (event.type === 'agent_start') return '[Pi iniciado]\n';
  if (event.type === 'turn_start') return '\n[Pi trabajando]\n';
  if (event.type === 'tool_execution_start') {
    return `\n\n[Pi ejecutando ${event.toolName || 'una herramienta'}]\n`;
  }
  if (event.type === 'tool_execution_update') {
    const partial = piReadableValue(event.partialResult);
    return partial ? `${partial}${partial.endsWith('\n') ? '' : '\n'}` : '';
  }
  if (event.type === 'tool_execution_end') {
    const result = piReadableValue(event.result);
    if (result) return `${result}${result.endsWith('\n') ? '' : '\n'}`;
    return `\n[Pi terminó ${event.toolName || 'la herramienta'}]\n`;
  }
  if (event.type === 'message_end' && event.message?.stopReason === 'error') {
    return `\n[Pi error: ${event.message.errorMessage || 'la respuesta terminó con error'}]\n`;
  }
  if (event.type === 'agent_end') return '\n[Pi terminó la respuesta]\n';
  if (event.type === 'agent_settled') return '\n[Pi listo para nuevos mensajes]\n';
  if (event.type === 'auto_retry_start') {
    return `\n[Pi reintentando (${event.attempt}/${event.maxAttempts})]\n`;
  }
  if (event.type === 'auto_retry_end' && event.success === false) {
    return `\n[Pi no pudo completar el reintento: ${event.finalError || 'error desconocido'}]\n`;
  }
  return '';
}

function consumePiJsonOutput(record, data, flush = false) {
  record.stdoutBuffer += Buffer.isBuffer(data) ? record.stdoutDecoder.write(data) : String(data ?? '');
  if (flush) record.stdoutBuffer += record.stdoutDecoder.end();
  const lines = record.stdoutBuffer.split(/\r?\n/);
  record.stdoutBuffer = flush ? '' : (lines.pop() || '');
  return lines.filter((line) => line.trim()).map((line) => {
    try {
      const event = JSON.parse(line);
      if (event?.type === 'agent_start') record.agentStreaming = true;
      if (event?.type === 'agent_settled') record.agentStreaming = false;
      return piJsonEventText(event);
    } catch {
      return `${line}\n`;
    }
  }).filter(Boolean);
}

function sddDirectoryFor(directoryPath) {
  const selectedPath = path.normalize(String(directoryPath || ''));
  return path.basename(selectedPath) === SDD_SPECS_DIR
    ? selectedPath
    : path.join(selectedPath, SDD_SPECS_DIR);
}

function sddProjectDirectoryFor(directoryPath) {
  const selectedPath = path.normalize(String(directoryPath || ''));
  return path.basename(selectedPath) === SDD_SPECS_DIR
    ? path.dirname(selectedPath)
    : selectedPath;
}

function collectSpecsResourceFiles(directoryPath) {
  const sddDirectory = sddDirectoryFor(directoryPath);
  const resourcesDirectory = path.join(sddDirectory, SDD_SPECS_RESOURCES_DIR);
  if (!fs.existsSync(resourcesDirectory) || !fs.statSync(resourcesDirectory).isDirectory()) return [];
  const found = [];
  const stack = [resourcesDirectory];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name.startsWith('.') || SDD_SPECS_SKIP_DIRECTORIES.has(entry.name)) continue;
        stack.push(entryPath);
      } else if (entry.isFile()) {
        found.push(entryPath);
      }
    }
  }
  return found.sort((a, b) => a.localeCompare(b));
}

function readSpecsFolderResources(directoryPath) {
  const resourcesDirectory = path.join(sddDirectoryFor(directoryPath), SDD_SPECS_RESOURCES_DIR);
  let totalBytes = 0;
  return collectSpecsResourceFiles(directoryPath).map((filePath) => {
    const stats = fs.statSync(filePath);
    const relativePath = path.relative(resourcesDirectory, filePath).split(path.sep).join('/');
    const detected = detectFileType(filePath, { fileName: relativePath });
    const type = detected.mime || 'application/octet-stream';
    const kind = detected.kind;
    const maxBytes = kind === 'video' ? SDD_SPECS_VIDEO_MAX_BYTES : kind === 'audio' ? SDD_SPECS_AUDIO_MAX_BYTES : kind === 'image' ? SDD_SPECS_IMAGE_MAX_BYTES : null;
    if (maxBytes && stats.size > maxBytes) {
      const limit = kind === 'image' ? '20 MB' : '100 MB';
      throw new Error(`El recurso “${path.basename(filePath)}” supera el límite de ${limit}`);
    }
    totalBytes += stats.size;
    if (totalBytes > SDD_SPECS_RESOURCES_MAX_TOTAL_BYTES) throw new Error('Los recursos de specs superan el límite de 200 MB');
    return {
      name: path.basename(filePath),
      relativePath,
      path: filePath,
      kind,
      type,
      detectedBy: detected.detectedBy,
      size: stats.size,
      modifiedAt: stats.mtime.toISOString()
    };
  });
}

function ensureSddStructure(directoryPath) {
  const sddDirectory = sddDirectoryFor(directoryPath);
  fs.mkdirSync(sddDirectory, { recursive: true });
  const resourcesDirectory = path.join(sddDirectory, SDD_SPECS_RESOURCES_DIR);
  if (!fs.existsSync(resourcesDirectory)) fs.mkdirSync(resourcesDirectory, { recursive: true });
  const legacySpecsPath = path.join(sddDirectory, 'specs.md');
  const specsDirectory = path.join(sddDirectory, SDD_SPECS_VERSIONS_DIR);
  const initialVersionPath = path.join(specsDirectory, '0.0.0.md');
  const fullPath = path.join(sddDirectory, SDD_FULL_FILENAME);
  const databasePath = path.join(sddDirectory, SDD_DATABASE_FILENAME);
  if (fs.existsSync(legacySpecsPath) && !fs.statSync(legacySpecsPath).isFile()) throw new Error('specs.md no es un archivo en la carpeta configurada');
  if (fs.existsSync(specsDirectory) && !fs.statSync(specsDirectory).isDirectory()) throw new Error('specs no es una carpeta en la carpeta configurada');
  if (fs.existsSync(fullPath) && !fs.statSync(fullPath).isFile()) throw new Error(`${SDD_FULL_FILENAME} no es un archivo en la carpeta configurada`);
  if (fs.existsSync(databasePath) && !fs.statSync(databasePath).isFile()) throw new Error(`${SDD_DATABASE_FILENAME} no es un archivo en la carpeta configurada`);

  // Un proyecto existente con specs.md como archivo se conserva intacto para
  // que el renderer pueda ofrecer la migración explícita; nunca se convierte
  // ni se sobrescribe de forma implícita al abrirlo.
  if (fs.existsSync(legacySpecsPath) && !fs.existsSync(specsDirectory)) {
    return { sddDirectory, legacySpecsPath, specsDirectory, fullPath, databasePath, resourcesDirectory, created: false, legacy: true };
  }
  if (fs.existsSync(legacySpecsPath)) {
    throw new Error('El proyecto mezcla specs.md antiguo con la carpeta specs; migra o limpia el formato anterior antes de continuar');
  }

  const exampleSpecs = `# Specs

## Requisito de ejemplo
- Estado: Activa

Describe el requisito: contexto, criterios de aceptación, condiciones y excepciones.
`;
  const exampleDatabase = `# BBDD

No hay tablas definidas.
`;
  const exampleFull = `# Specs completas

## Versión 0.0.0

### Requisito de ejemplo
- Estado: Activa

Describe el requisito: contexto, criterios de aceptación, condiciones y excepciones.
`;
  let created = false;
  if (!fs.existsSync(specsDirectory)) fs.mkdirSync(specsDirectory, { recursive: true, mode: 0o700 });
  const hasVersionFiles = fs.readdirSync(specsDirectory, { withFileTypes: true })
    .some((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'));
  if (!hasVersionFiles) {
    fs.writeFileSync(initialVersionPath, exampleSpecs, { encoding: 'utf8', mode: 0o600 });
    created = true;
  }
  if (!fs.existsSync(fullPath)) {
    fs.writeFileSync(fullPath, exampleFull, { encoding: 'utf8', mode: 0o600 });
    created = true;
  }
  if (!fs.existsSync(databasePath)) {
    fs.writeFileSync(databasePath, exampleDatabase, { encoding: 'utf8', mode: 0o600 });
    created = true;
  }
  return { sddDirectory, specsDirectory, initialVersionPath, fullPath, databasePath, resourcesDirectory, created, legacy: false };
}

function searchPreferencesPath() {
  return path.join(app.getPath('userData'), SEARCH_PREFERENCES_FILENAME);
}

function readSearchPreferences() {
  try {
    const value = JSON.parse(fs.readFileSync(searchPreferencesPath(), 'utf8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('No se pudieron cargar los ajustes de búsqueda:', error.message);
    return null;
  }
}

function writeSearchPreferences(preferences) {
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) {
    throw new Error('Los ajustes de búsqueda no son válidos');
  }
  fs.writeFileSync(searchPreferencesPath(), `${JSON.stringify(preferences)}\n`, { encoding: 'utf8', mode: 0o600 });
  return true;
}

function sddLastProjectPath() {
  return path.join(app.getPath('userData'), SDD_LAST_PROJECT_FILENAME);
}

function readSddLastProject() {
  try {
    const value = JSON.parse(fs.readFileSync(sddLastProjectPath(), 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const projectPath = typeof value.path === 'string' ? value.path.trim() : '';
    if (!projectPath) return null;
    return {
      path: projectPath,
      name: typeof value.name === 'string' ? value.name.slice(0, 120) : '',
      savedAt: typeof value.savedAt === 'string' ? value.savedAt : null
    };
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('No se pudo cargar el último proyecto S.D.D:', error.message);
    return null;
  }
}

function writeSddLastProject(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('El último proyecto S.D.D no es válido');
  }
  const projectPath = typeof payload.path === 'string' ? payload.path.trim() : '';
  if (!projectPath) {
    try {
      fs.rmSync(sddLastProjectPath(), { force: true });
    } catch {
      // No poder borrar el recuerdo no debe impedir el uso de la aplicación.
    }
    return true;
  }
  const value = {
    path: projectPath,
    name: typeof payload.name === 'string' ? payload.name.slice(0, 120) : '',
    savedAt: new Date().toISOString()
  };
  fs.writeFileSync(sddLastProjectPath(), `${JSON.stringify(value)}\n`, { encoding: 'utf8', mode: 0o600 });
  return true;
}

function lastViewPath() {
  return path.join(app.getPath('userData'), LAST_VIEW_FILENAME);
}

function normaliseLastView(value) {
  return typeof value === 'string' && AVAILABLE_VIEWS.has(value.trim())
    ? value.trim()
    : DEFAULT_VIEW;
}

function readLastView() {
  try {
    const value = JSON.parse(fs.readFileSync(lastViewPath(), 'utf8'));
    return normaliseLastView(value?.view);
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn('No se pudo cargar la última sección:', error.message);
    return DEFAULT_VIEW;
  }
}

function writeLastView(value) {
  const view = normaliseLastView(value);
  fs.writeFileSync(lastViewPath(), `${JSON.stringify({ version: 1, view })}\n`, { encoding: 'utf8', mode: 0o600 });
  return view;
}

function windowFromEvent(event) {
  try {
    const window = BrowserWindow.fromWebContents(event?.sender);
    return window && !window.isDestroyed() ? window : null;
  } catch {
    return null;
  }
}

async function showOpenDialogFor(event, options) {
  const parent = windowFromEvent(event);
  return parent ? dialog.showOpenDialog(parent, options) : dialog.showOpenDialog(options);
}

async function showSaveDialogFor(event, options) {
  const parent = windowFromEvent(event);
  return parent ? dialog.showSaveDialog(parent, options) : dialog.showSaveDialog(options);
}

function piEnvironment() {
  const userBinDirectories = process.platform === 'win32'
    ? []
    : [
      path.join(os.homedir(), '.local', 'bin'),
      path.join(os.homedir(), '.npm-global', 'bin'),
      '/opt/homebrew/bin',
      '/usr/local/bin'
    ];
  const currentPath = String(process.env.PATH || '');
  const pathEntries = [...new Set([...userBinDirectories, ...currentPath.split(path.delimiter).filter(Boolean)])];
  return {
    ...process.env,
    PATH: pathEntries.join(path.delimiter),
    TERM: process.env.TERM || 'xterm-256color',
    COLORTERM: process.env.COLORTERM || 'truecolor',
    // The terminal view renders text output itself, so avoid cursor control
    // sequences intended for a native TTY.
    FORCE_COLOR: '0'
  };
}

function piCommand() {
  const configured = String(process.env.PI_COMMAND || '').trim();
  return configured || 'pi';
}

function validPiProvider(value) {
  const provider = String(value || PI_DEFAULT_PROVIDER).trim();
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(provider)) throw new Error('El proveedor de Pi no es válido');
  return provider;
}

function validPiModel(value) {
  const model = String(value || PI_DEFAULT_MODEL).trim();
  // Pi admite patrones y el formato provider/model[:thinking]. Se pasan como
  // argumentos separados, nunca por un shell, para evitar interpolación.
  if (!/^[A-Za-z0-9._:*?+\-/]{1,180}$/.test(model)) throw new Error('El modelo de Pi no es válido');
  return model;
}

function validPiThinking(value) {
  const thinking = String(value || PI_DEFAULT_THINKING).trim().toLowerCase();
  if (!PI_THINKING_LEVELS.has(thinking)) throw new Error('El nivel de razonamiento de Pi no es válido');
  return thinking;
}

function validPiOutputFlushInterval(value) {
  const interval = Number(value ?? PI_OUTPUT_FLUSH_INTERVAL_MS);
  if (!Number.isFinite(interval)) throw new Error('La frecuencia de actualización de Pi no es válida');
  return Math.min(Math.max(Math.round(interval), PI_OUTPUT_FLUSH_MIN_INTERVAL_MS), PI_OUTPUT_FLUSH_MAX_INTERVAL_MS);
}

function validPiProjectPath(value) {
  const requestedPath = String(value || '').trim();
  if (!requestedPath) throw new Error('Carga un proyecto S.D.D antes de ejecutar Pi');
  const projectPath = path.resolve(requestedPath);
  if (!projectPath || !fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) {
    throw new Error('La raíz del proyecto S.D.D no es válida o ya no existe');
  }
  return projectPath;
}

function sendPiTerminalEvent(window, channel, payload) {
  if (!window || window.isDestroyed()) return false;
  try {
    const contents = window.webContents;
    if (!contents || contents.isDestroyed() || contents.isLoadingMainFrame()) return false;
    const frame = contents.mainFrame;
    if (!frame || frame.isDestroyed() || frame.detached) return false;
    frame.send(channel, payload);
    return true;
  } catch {
    // La ventana puede estar cerrándose mientras termina el proceso.
    return false;
  }
}

function stopPiProcessForWindow(window) {
  const record = window ? piProcesses.get(window) : null;
  if (!record || !record.child || record.child.killed) return false;
  record.stopRequested = true;
  try {
    record.child.kill(process.platform === 'win32' ? undefined : 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

function setPiOutputRefreshIntervalForWindow(window, value) {
  const intervalMs = validPiOutputFlushInterval(value);
  const record = window ? piProcesses.get(window) : null;
  if (!record || record.finished) return { intervalMs, running: false };
  record.outputFlushIntervalMs = intervalMs;
  if (record.outputFlushTimer) clearTimeout(record.outputFlushTimer);
  record.outputFlushTimer = null;
  if (record.outputPending) record.scheduleOutputFlush?.();
  return { intervalMs, running: true };
}

function writePiRpcCommand(record, command) {
  const input = record?.child?.stdin;
  if (!input || input.destroyed || !input.writable) throw new Error('La sesión de Pi ya no acepta mensajes');
  input.write(`${JSON.stringify(command)}\n`, 'utf8');
}

function sendPiMessageForWindow(window, value) {
  const record = window ? piProcesses.get(window) : null;
  if (!record || record.finished || !record.child || record.child.killed) {
    throw new Error('No hay una sesión de Pi activa');
  }
  const message = typeof value === 'string' ? value.trim() : '';
  if (!message) throw new Error('Escribe un mensaje para Pi');
  if (Buffer.byteLength(message, 'utf8') > PI_MAX_MESSAGE_BYTES) {
    throw new Error('El mensaje para Pi supera el límite de 100 KB');
  }
  const queued = record.agentStreaming === true;
  const command = {
    id: `${record.runId}-message-${++record.rpcRequestNumber}`,
    type: queued ? 'follow_up' : 'prompt',
    message
  };
  writePiRpcCommand(record, command);
  // Evita que dos envíos inmediatos intenten iniciar dos respuestas simultáneas.
  record.agentStreaming = true;
  return { queued };
}

function startPiProcess(event, payload = {}) {
  const window = windowFromEvent(event);
  if (!window) throw new Error('La ventana de NexusData ya no está disponible');
  const previous = piProcesses.get(window);
  if (previous && !previous.finished) throw new Error('Ya hay una ejecución de Pi en curso');

  const projectPath = validPiProjectPath(payload.projectPath);
  const prompt = typeof payload.prompt === 'string' ? payload.prompt : '';
  if (!prompt.trim()) throw new Error('El prompt de Specs está vacío');
  if (Buffer.byteLength(prompt, 'utf8') > PI_MAX_PROMPT_BYTES) throw new Error('El prompt de Specs supera el límite permitido');
  const provider = validPiProvider(payload.provider);
  const model = validPiModel(payload.model);
  const thinking = validPiThinking(payload.thinking);
  const outputFlushIntervalMs = validPiOutputFlushInterval(payload.outputRefreshIntervalMs);
  const runId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const command = piCommand();
  const args = [
    '--provider', provider,
    '--model', model,
    '--thinking', thinking,
    '--approve',
    '--mode', 'rpc'
  ];
  const record = {
    agentStreaming: true,
    child: null,
    finished: false,
    outputBytes: 0,
    outputFlushIntervalMs,
    outputFlushTimer: null,
    outputPending: '',
    outputTruncated: false,
    rpcRequestNumber: 0,
    runId,
    stopRequested: false,
    stdoutBuffer: '',
    stdoutDecoder: new StringDecoder('utf8')
  };

  try {
    record.child = spawn(command, args, {
      cwd: projectPath,
      env: piEnvironment(),
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    piProcesses.set(window, record);
  } catch (error) {
    throw new Error(`No se pudo iniciar pi: ${error.message}`);
  }

  const flushOutput = () => {
    if (!record.outputPending) return true;
    const data = record.outputPending;
    if (!sendPiTerminalEvent(window, 'pi-terminal-output', { runId, stream: 'stdout', data })) return false;
    record.outputPending = '';
    return true;
  };
  const scheduleOutputFlush = () => {
    if (record.finished || record.outputFlushTimer) return;
    record.outputFlushTimer = setTimeout(() => {
      record.outputFlushTimer = null;
      flushOutput();
      if (record.outputPending) scheduleOutputFlush();
    }, record.outputFlushIntervalMs);
    record.outputFlushTimer.unref?.();
  };
  record.scheduleOutputFlush = scheduleOutputFlush;
  const queueOutput = (data) => {
    if (record.outputTruncated) return;
    const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data ?? '');
    record.outputBytes += Buffer.byteLength(text, 'utf8');
    if (record.outputBytes > PI_MAX_OUTPUT_BYTES) {
      record.outputTruncated = true;
      record.outputPending += '\n[Salida de Pi truncada al superar 10 MB.]\n';
      scheduleOutputFlush();
      return;
    }
    record.outputPending += text;
    scheduleOutputFlush();
  };
  record.child.stdout?.on('data', (data) => {
    consumePiJsonOutput(record, data).forEach((text) => queueOutput(text));
  });
  record.child.stderr?.on('data', (data) => queueOutput(data));
  record.child.stdin?.on('error', (error) => {
    if (!record.finished) {
      sendPiTerminalEvent(window, 'pi-terminal-error', { runId, message: `No se pudo enviar un mensaje a Pi: ${error.message}` });
    }
  });
  record.child.once('error', (error) => {
    sendPiTerminalEvent(window, 'pi-terminal-error', { runId, message: `No se pudo ejecutar pi: ${error.message}` });
  });
  record.child.once('close', (code, signal) => {
    record.finished = true;
    record.agentStreaming = false;
    consumePiJsonOutput(record, '', true).forEach((text) => queueOutput(text));
    if (record.outputFlushTimer) clearTimeout(record.outputFlushTimer);
    record.outputFlushTimer = null;
    flushOutput();
    if (piProcesses.get(window) === record) piProcesses.delete(window);
    sendPiTerminalEvent(window, 'pi-terminal-exit', {
      runId,
      code: Number.isInteger(code) ? code : null,
      signal: signal || null,
      stopped: record.stopRequested === true
    });
  });

  try {
    writePiRpcCommand(record, {
      id: `${runId}-follow-up-mode`,
      type: 'set_follow_up_mode',
      mode: 'one-at-a-time'
    });
    writePiRpcCommand(record, {
      id: `${runId}-initial`,
      type: 'prompt',
      message: prompt
    });
  } catch (error) {
    record.stopRequested = true;
    try { record.child.kill(process.platform === 'win32' ? undefined : 'SIGTERM'); } catch { /* El proceso ya terminó. */ }
    throw new Error(`No se pudo enviar el prompt inicial a Pi: ${error.message}`);
  }

  return { runId, cwd: projectPath, provider, model, thinking, outputRefreshIntervalMs: outputFlushIntervalMs };
}

// Menú nativo de edición: los roles de Electron habilitan Ctrl/Cmd+C y Ctrl/Cmd+X
// en los campos de texto del renderer, además de pegar y seleccionar todo.
function applicationEditMenu() {
  return {
    label: EDIT_MENU_NAME,
    submenu: [
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { type: 'separator' },
      { role: 'selectAll' }
    ]
  };
}

function setApplicationMenuForView(window, view) {
  applicationMenuViews.set(window, view);
  const customPromptItems = applicationMenuPromptItems.get(window) || [];
  const template = [
    {
      // macOS reserves the first top-level item for the application menu.
      // Its visible name is controlled by Electron/the application bundle.
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services', submenu: [] },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }
  ];

  template.push(applicationEditMenu());

  template.push({
    label: PROJECT_MENU_NAME,
    submenu: [
      {
        label: 'Nuevo Proyecto',
        click: () => window.webContents.send('project-menu-action', 'new-project')
      },
      {
        label: 'Cargar Proyecto',
        click: () => window.webContents.send('project-menu-action', 'load-project')
      }
    ]
  });

  if (String(view || '').startsWith('sdd')) {
    template.push({
      label: SPECS_MENU_NAME,
      submenu: [
        {
          label: 'Crear SDD_specs',
          click: () => window.webContents.send('sdd-menu-action', 'create')
        }
      ]
    });
  }

  template.push({
    label: PREFERENCES_MENU_NAME,
    submenu: [
      {
        label: 'Paleta de colores',
        submenu: [
          {
            label: 'Noche azul',
            click: () => window.webContents.send('preferences-menu-action', 'palette', 'midnight')
          },
          {
            label: 'Océano',
            click: () => window.webContents.send('preferences-menu-action', 'palette', 'ocean')
          },
          {
            label: 'Bosque',
            click: () => window.webContents.send('preferences-menu-action', 'palette', 'forest')
          },
          {
            label: 'Ciruela',
            click: () => window.webContents.send('preferences-menu-action', 'palette', 'plum')
          }
        ]
      },
      {
        label: 'Contraste de líneas',
        submenu: [
          {
            label: 'Bajo',
            click: () => window.webContents.send('preferences-menu-action', 'diagram-line-contrast', 'low')
          },
          {
            label: 'Medio',
            click: () => window.webContents.send('preferences-menu-action', 'diagram-line-contrast', 'normal')
          },
          {
            label: 'Intermedio',
            click: () => window.webContents.send('preferences-menu-action', 'diagram-line-contrast', 'high')
          },
          {
            label: 'Alto',
            click: () => window.webContents.send('preferences-menu-action', 'diagram-line-contrast', 'very-high')
          }
        ]
      },
      {
        label: 'Estilo de letra',
        click: () => window.webContents.send('preferences-menu-action', 'diagram-font-size')
      }
    ]
  });

  template.push({
    label: EXPORT_MENU_NAME,
    submenu: [
      {
        label: 'Exportar espacio de trabajo',
        click: () => window.webContents.send('workspace-menu-action', 'export')
      },
      {
        label: 'Importar espacio de trabajo',
        click: () => window.webContents.send('workspace-menu-action', 'import')
      }
    ]
  });

  if (view === 'html-viewer') {
    template.push({
      label: HTML_VIEW_MENU_NAME,
      submenu: [
        {
          label: 'Abrir Carpeta',
          click: () => window.webContents.send('html-viewer-menu-action', 'choose-folder')
        },
        {
          label: 'Abrir Archivo',
          click: () => window.webContents.send('html-viewer-menu-action', 'choose-files')
        },
        { type: 'separator' },
        {
          label: 'Cerrar documento',
          click: () => window.webContents.send('html-viewer-menu-action', 'close-document')
        }
      ]
    });
  }

  if (view === 'diagrams') {
    template.push({
      label: DIAGRAM_MENU_NAME,
      submenu: [
        {
          label: 'Nuevo diagrama',
          click: () => window.webContents.send('diagram-menu-action', 'new')
        },
        {
          label: 'Duplicar diagrama',
          click: () => window.webContents.send('diagram-menu-action', 'duplicate')
        },
        { type: 'separator' },
        {
          label: 'Código del diagrama',
          click: () => window.webContents.send('diagram-menu-action', 'code')
        },
        {
          label: 'Importar',
          click: () => window.webContents.send('diagram-menu-action', 'import')
        },
        {
          label: 'Exportar',
          click: () => window.webContents.send('diagram-menu-action', 'export')
        },
        {
          label: 'Exportar como imagen',
          click: () => window.webContents.send('diagram-menu-action', 'export-image')
        },
        { type: 'separator' },
        {
          label: 'Eliminar diagrama',
          click: () => window.webContents.send('diagram-menu-action', 'delete')
        },
        { type: 'separator' },
        {
          label: 'Deshacer',
          click: () => window.webContents.send('diagram-menu-action', 'undo')
        },
        {
          label: 'Rehacer',
          click: () => window.webContents.send('diagram-menu-action', 'redo')
        }
      ]
    });
  }

  template.push({
    label: PROMPTS_MENU_NAME,
    submenu: [
      {
        label: 'Configurar prompts',
        click: () => window.webContents.send('html-viewer-menu-action', 'configure-prompts')
      },
      { type: 'separator' },
      {
        label: 'Nuevo diagrama prompt',
        click: () => window.webContents.send('html-viewer-menu-action', 'new-diagram-prompt')
      },
      {
        label: 'Analizar diff de git',
        click: () => window.webContents.send('html-viewer-menu-action', 'copy-git-diff-prompt')
      },
      {
        label: 'Generar especificaciones completadas',
        click: () => window.webContents.send('html-viewer-menu-action', 'copy-completed-specs-prompt')
      },
      {
        label: 'Trabajar siguiendo specs',
        click: () => window.webContents.send('html-viewer-menu-action', 'copy-follow-specs-prompt')
      },
      ...(customPromptItems.length ? [
        { type: 'separator' },
        {
          label: 'Mis prompts',
          submenu: customPromptItems.map((prompt) => ({
            label: prompt.name,
            click: () => window.webContents.send('html-viewer-menu-action', 'copy-custom-prompt', prompt.id)
          }))
        }
      ] : [])
    ]
  });

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function bindCloseConfirmation(window) {
  const closeState = { closeConfirmed: false, pending: false };
  closeConfirmationStates.set(window, closeState);
  window.on('close', (event) => {
    if (closeState.closeConfirmed) return;

    event.preventDefault();
    if (closeState.pending) return;
    closeState.pending = true;
    window.webContents.send('close-confirmation-request');
  });
  window.on('closed', () => {
    stopPiProcessForWindow(window);
    closeConfirmationStates.delete(window);
  });
}

function createWindow(apiBase) {
  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1120,
    minHeight: 720,
    backgroundColor: '#000000',
    show: false,
    opacity: process.platform === 'win32' ? 0 : 1,
    paintWhenInitiallyHidden: false,
    title: 'NexusData',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  bindCloseConfirmation(window);
  window.webContents.on('render-process-gone', () => stopPiProcessForWindow(window));
  setApplicationMenuForView(window, null);
  const revealWindow = () => {
    window.maximize();
    window.show();
    if (process.platform === 'win32') window.setOpacity(1);
  };
  window.webContents.once('did-finish-load', revealWindow);
  window.loadURL(apiBase);
  return window;
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);

  ipcMain.handle('set-view-menu', (event, view) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) setApplicationMenuForView(window, view);
    return true;
  });

  ipcMain.handle('update-prompt-menu', (event, items) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return false;
    const values = Array.isArray(items) ? items : [];
    const safeItems = values
      .filter((item) => item && typeof item.id === 'string' && typeof item.name === 'string')
      .slice(0, 100)
      .map((item) => ({
        id: item.id.slice(0, 120),
        name: item.name.trim().slice(0, 120) || 'Prompt sin nombre'
      }));
    applicationMenuPromptItems.set(window, safeItems);
    setApplicationMenuForView(window, applicationMenuViews.get(window) || null);
    return true;
  });

  ipcMain.handle('start-pi-terminal', (event, payload = {}) => startPiProcess(event, payload));
  ipcMain.handle('stop-pi-terminal', (event) => stopPiProcessForWindow(windowFromEvent(event)));
  ipcMain.handle('send-pi-terminal-message', (event, message) => sendPiMessageForWindow(windowFromEvent(event), message));
  ipcMain.handle('set-pi-terminal-refresh-interval', (event, intervalMs) => setPiOutputRefreshIntervalForWindow(windowFromEvent(event), intervalMs));
  ipcMain.handle('get-pi-model-catalog', () => piModelCatalog());

  ipcMain.on('close-confirmation-result', (event, confirmed) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const closeState = window ? closeConfirmationStates.get(window) : null;
    if (!window || !closeState || !closeState.pending) return;
    closeState.pending = false;
    if (confirmed === true) {
      closeState.closeConfirmed = true;
      app.quit();
    }
  });

  ipcMain.handle('load-search-preferences', () => readSearchPreferences());
  ipcMain.handle('save-search-preferences', (_event, preferences) => writeSearchPreferences(preferences));
  ipcMain.handle('load-sdd-last-project', () => readSddLastProject());
  ipcMain.handle('save-sdd-last-project', (_event, payload) => writeSddLastProject(payload));
  ipcMain.handle('load-last-view', () => readLastView());
  ipcMain.handle('save-last-view', (_event, view) => writeLastView(view));

  ipcMain.handle('select-workspace-file', async (event) => {
    const result = await showOpenDialogFor(event, {
      title: 'Importar espacio de trabajo',
      properties: ['openFile'],
      filters: [{ name: 'Espacio de trabajo NexusData', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = path.normalize(result.filePaths[0]);
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) throw new Error('La ubicación elegida no es un archivo');
    if (stats.size > WORKSPACE_MAX_FILE_BYTES) throw new Error('El archivo del espacio de trabajo supera el límite de 50 MB');
    return { path: filePath, content: fs.readFileSync(filePath, 'utf8') };
  });

  ipcMain.handle('save-workspace-file', async (event, payload = {}) => {
    if (!payload || typeof payload.content !== 'string') throw new Error('El contenido del espacio de trabajo no es válido');
    if (Buffer.byteLength(payload.content, 'utf8') > WORKSPACE_MAX_FILE_BYTES) throw new Error('El espacio de trabajo supera el límite de 50 MB');
    const result = await showSaveDialogFor(event, {
      title: 'Exportar espacio de trabajo',
      defaultPath: path.join(app.getPath('documents'), 'nexusdata-workspace.json'),
      filters: [{ name: 'Espacio de trabajo NexusData', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePath) return null;
    let filePath = path.normalize(result.filePath);
    if (!path.extname(filePath)) filePath += '.json';
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) throw new Error('La ubicación elegida es una carpeta');
    fs.writeFileSync(filePath, payload.content, { encoding: 'utf8', mode: 0o600 });
    return filePath;
  });

  ipcMain.handle('select-local-paths', async (event, options = {}) => {
    const directory = Boolean(options.directory);
    const audioExtensions = ['mp3', 'mpga', 'wav', 'wave', 'oga', 'ogg', 'opus', 'm4a', 'm4b', 'aac', 'flac', 'weba', 'wma', 'aiff', 'aif', 'aifc', 'au', 'snd', 'amr', '3gp', 'caf', 'mka', 'mp2', 'mpa', 'ac3', 'dts', 'eac3', 'gsm', 'ra', 'ram', 'voc', 'ape', 'wv', 'tta', 'dsf', 'dff', 'mid', 'midi', 'kar'];
    // No se usa `extensions: ['*']` para "Todos los archivos": en macOS
    // (Electron 36.2+) rompe el NSOpenPanel con el error view-bridge
    // `Connection interrupted` y el diálogo no llega a abrirse.
    // Sin `filters`, macOS muestra todos los archivos por defecto.
    const dialogOptions = directory
      ? {
        title: 'Seleccionar carpeta con documentación',
        properties: ['openDirectory', 'createDirectory']
      }
      : {
        title: 'Seleccionar documentos',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'Documentos y recursos compatibles', extensions: ['json', 'csv', 'txt', 'md', 'markdown', 'html', 'htm', 'nxd', 'png', 'jpg', 'jpeg', 'webp', 'avif', 'bmp', 'tif', 'tiff', 'svg', 'gif', 'mp4', 'm4v', 'webm', 'ogv', 'mov', ...audioExtensions] }]
      };
    const result = await showOpenDialogFor(event, dialogOptions);
    if (result.canceled || !Array.isArray(result.filePaths)) return [];
    return result.filePaths;
  });

  ipcMain.handle('get-file-system-roots', (_event, additionalRoots) => fileExplorerService.getRoots(additionalRoots));
  ipcMain.handle('select-sdd-specs-path', async (event, lastPath = '') => {
    const trimmedLastPath = String(lastPath || '').trim();
    const result = await showOpenDialogFor(event, {
      title: 'Seleccionar carpeta contenedora',
      buttonLabel: 'Crear SDD_specs',
      ...(trimmedLastPath ? { defaultPath: path.normalize(trimmedLastPath) } : {}),
      properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const directoryPath = path.normalize(result.filePaths[0]);
    if (!fs.statSync(directoryPath).isDirectory()) throw new Error('La ubicación elegida no es una carpeta');
    const structure = ensureSddStructure(directoryPath);
    return { path: sddProjectDirectoryFor(directoryPath), sddPath: structure.sddDirectory, created: structure.created };
  });

  const loadSddProject = async (eventOrFolderPath = '', folderOrOptions = '', maybeOptions = {}) => {
    const event = eventOrFolderPath && typeof eventOrFolderPath === 'object' && eventOrFolderPath.sender ? eventOrFolderPath : null;
    const folderPath = event ? folderOrOptions : eventOrFolderPath;
    const options = event ? maybeOptions : folderOrOptions;
    const requestedPath = String(folderPath || '').trim();
    let directoryPath = requestedPath ? path.normalize(requestedPath) : '';
    if (!directoryPath || !fs.existsSync(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
      if (options?.prompt === false) return null;
      const result = await showOpenDialogFor(event, {
        title: 'Seleccionar proyecto S.D.D',
        buttonLabel: 'Cargar',
        defaultPath: directoryPath || undefined,
        properties: ['openDirectory']
      });
      if (result.canceled || !result.filePaths[0]) return null;
      directoryPath = path.normalize(result.filePaths[0]);
    }
    if (!fs.statSync(directoryPath).isDirectory()) throw new Error('La ubicación elegida no es una carpeta');
    const projectPath = sddProjectDirectoryFor(directoryPath);
    const sddDirectory = sddDirectoryFor(directoryPath);
    const legacySpecsPath = path.join(sddDirectory, 'specs.md');
    const specsDirectory = path.join(sddDirectory, SDD_SPECS_VERSIONS_DIR);
    const legacy = fs.existsSync(legacySpecsPath) && fs.statSync(legacySpecsPath).isFile() && !fs.existsSync(specsDirectory);
    if (!legacy && (!fs.existsSync(specsDirectory) || !fs.statSync(specsDirectory).isDirectory())) {
      throw new Error(`El proyecto no contiene la carpeta ${SDD_SPECS_DIR}/${SDD_SPECS_VERSIONS_DIR}`);
    }
    const versionFiles = legacy
      ? []
      : fs.readdirSync(specsDirectory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.md'))
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right, 'es', { numeric: true, sensitivity: 'base' }));
    if (!legacy && !versionFiles.length) throw new Error(`El proyecto no contiene versiones en ${SDD_SPECS_DIR}/${SDD_SPECS_VERSIONS_DIR}`);
    const specsPath = legacy ? legacySpecsPath : path.join(specsDirectory, versionFiles.at(-1));
    const resourcesDir = path.join(sddDirectory, SDD_SPECS_RESOURCES_DIR);
    if (!legacy && (!fs.existsSync(resourcesDir) || !fs.statSync(resourcesDir).isDirectory())) throw new Error(`El proyecto no contiene la carpeta ${SDD_SPECS_DIR}/${SDD_SPECS_RESOURCES_DIR}`);
    const fullPath = path.join(sddDirectory, SDD_FULL_FILENAME);
    const databasePath = path.join(sddDirectory, SDD_DATABASE_FILENAME);
    if (!legacy && (!fs.existsSync(databasePath) || !fs.statSync(databasePath).isFile())) throw new Error(`El proyecto no contiene un archivo ${SDD_SPECS_DIR}/${SDD_DATABASE_FILENAME}`);
    const content = fs.existsSync(fullPath) && fs.statSync(fullPath).isFile() ? fs.readFileSync(fullPath, 'utf8') : '';
    return {
      name: path.basename(projectPath) || projectPath,
      path: projectPath,
      sddPath: sddDirectory,
      specsPath,
      specsDirectory,
      fullPath,
      databasePath,
      resourcesPath: resourcesDir,
      content,
      resources: readSpecsFolderResources(directoryPath),
      legacy
    };
  };

  ipcMain.handle('load-sdd-project', (event, folderPath = '', options = {}) => loadSddProject(event, folderPath, options));
  // Compatibilidad con versiones del renderer que todavía usan el nombre anterior.
  ipcMain.handle('load-sdd-specs-markdown', (event, folderPath = '', options = {}) => loadSddProject(event, folderPath, options));

  ipcMain.handle('read-sdd-specs-resources', (_event, folderPath = '') => {
    const directoryPath = path.normalize(String(folderPath || ''));
    if (!directoryPath || !fs.existsSync(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
      throw new Error('La carpeta de specs no es válida o ya no existe');
    }
    return { path: sddProjectDirectoryFor(directoryPath), sddPath: sddDirectoryFor(directoryPath), resources: readSpecsFolderResources(directoryPath) };
  });

  ipcMain.handle('list-file-system-directory', (_event, directoryPath) => fileExplorerService.listDirectory(directoryPath));
  ipcMain.handle('search-file-system', (_event, payload) => fileExplorerService.searchDirectory(payload));
  ipcMain.handle('open-file-system-entry', (_event, filePath) => fileExplorerService.openEntry(filePath));
  ipcMain.handle('create-file-system-directory', (_event, payload) => fileExplorerService.createDirectory(payload));
  ipcMain.handle('create-file-system-file', (_event, payload) => fileExplorerService.createFile(payload));
  ipcMain.handle('rename-file-system-entry', (_event, payload) => fileExplorerService.renameEntry(payload));
  ipcMain.handle('delete-file-system-entries', (_event, payload) => fileExplorerService.deleteEntries(payload));
  ipcMain.handle('transfer-file-system-entries', (_event, payload) => fileExplorerService.transferEntries(payload));

  ipcMain.handle('select-diagram-file', async (event) => {
    const result = await showOpenDialogFor(event, {
      title: 'Importar diagrama por texto',
      properties: ['openFile'],
      filters: [{ name: 'Diagramas de texto', extensions: ['nxd', 'txt', 'md', 'markdown', 'json'] }]
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = path.normalize(result.filePaths[0]);
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) throw new Error('La ubicación elegida no es un archivo');
    if (stats.size > DIAGRAM_MAX_FILE_BYTES) throw new Error('El archivo del diagrama supera el límite de 2 MB');
    return { path: filePath, content: fs.readFileSync(filePath, 'utf8') };
  });

  ipcMain.handle('save-diagram-file', async (event, payload = {}) => {
    if (!payload || typeof payload.content !== 'string') throw new Error('El contenido del diagrama no es válido');
    const format = payload.format === 'json' ? 'json' : payload.format === 'png' ? 'png' : 'nxd';
    let imageBuffer = null;
    if (format === 'png') {
      const match = /^data:image\/png;base64,([A-Za-z0-9+/]+={0,2})$/.exec(payload.content);
      if (!match || match[1].length % 4 !== 0) throw new Error('La imagen del diagrama no es válida');
      imageBuffer = Buffer.from(match[1], 'base64');
      const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
      if (!imageBuffer.length || imageBuffer.subarray(0, pngSignature.length).compare(pngSignature) !== 0) {
        throw new Error('La imagen del diagrama no es válida');
      }
      if (imageBuffer.length > DIAGRAM_MAX_IMAGE_BYTES) throw new Error('La imagen del diagrama supera el límite de 50 MB');
    } else if (Buffer.byteLength(payload.content, 'utf8') > DIAGRAM_MAX_FILE_BYTES) {
      throw new Error('El diagrama supera el límite de 2 MB');
    }
    const extension = `.${format}`;
    const result = await showSaveDialogFor(event, {
      title: 'Exportar diagrama',
      defaultPath: path.join(app.getPath('documents'), `diagrama${extension}`),
      filters: [{
        name: format === 'png' ? 'Imagen PNG' : format === 'json' ? 'JSON' : 'Diagrama por texto',
        extensions: [format]
      }]
    });
    if (result.canceled || !result.filePath) return null;
    let filePath = path.normalize(result.filePath);
    if (!path.extname(filePath)) filePath += extension;
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) throw new Error('La ubicación elegida es una carpeta');
    if (format === 'png') {
      fs.writeFileSync(filePath, imageBuffer, { mode: 0o600 });
    } else {
      fs.writeFileSync(filePath, payload.content, { encoding: 'utf8', mode: 0o600 });
    }
    return filePath;
  });

  ipcMain.handle('create-project-directory', async (event) => {
    const result = await showSaveDialogFor(event, {
      title: 'Crear proyecto global',
      buttonLabel: 'Crear proyecto',
      defaultPath: path.join(app.getPath('documents'), 'ContextoConciencia')
    });
    if (result.canceled || !result.filePath) return null;
    const projectPath = path.normalize(result.filePath);
    if (fs.existsSync(projectPath) && !fs.statSync(projectPath).isDirectory()) {
      throw new Error('La ubicación elegida no es una carpeta');
    }
    fs.mkdirSync(projectPath, { recursive: true });
    return projectPath;
  });

  ipcMain.handle('create-sdd-project', async (event) => {
    const result = await showSaveDialogFor(event, {
      title: 'Nuevo Proyecto',
      buttonLabel: 'Crear proyecto',
      defaultPath: path.join(app.getPath('documents'), 'ContextoConciencia')
    });
    if (result.canceled || !result.filePath) return null;
    const directoryPath = path.normalize(result.filePath);
    if (fs.existsSync(directoryPath) && !fs.statSync(directoryPath).isDirectory()) {
      throw new Error('La ubicación elegida no es una carpeta');
    }
    fs.mkdirSync(directoryPath, { recursive: true });
    const structure = ensureSddStructure(directoryPath);
    const content = fs.readFileSync(structure.fullPath, 'utf8');
    if (!content.trim()) throw new Error(`${SDD_FULL_FILENAME} está vacío`);
    return {
      name: path.basename(directoryPath) || directoryPath,
      path: directoryPath,
      sddPath: structure.sddDirectory,
      specsPath: structure.initialVersionPath,
      specsDirectory: structure.specsDirectory,
      fullPath: structure.fullPath,
      databasePath: structure.databasePath,
      resourcesPath: structure.resourcesDirectory,
      content,
      resources: readSpecsFolderResources(directoryPath),
      created: true
    };
  });

  ipcMain.handle('reveal-file', (_event, filePath) => fileExplorerService.revealEntry(filePath));

  try {
    apiServer = await startServer({
      port: DESKTOP_PORT,
      dbPath: path.join(app.getPath('userData'), 'nexusdata.db'),
      offlineOnly: OFFLINE_ONLY
    });
    createWindow(`http://${apiServer.host}:${apiServer.port}`);
  } catch (error) {
    dialog.showErrorBox('NexusData no pudo iniciarse', error.message);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  for (const window of BrowserWindow.getAllWindows()) stopPiProcessForWindow(window);
  if (apiServer) {
    const server = apiServer;
    apiServer = null;
    await server.close();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && apiServer) {
    createWindow(`http://${apiServer.host}:${apiServer.port}`);
  }
});
