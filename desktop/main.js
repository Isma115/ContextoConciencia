const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const { startServer } = require('../server/app');
const { createFileExplorerService } = require('./file-explorer-service');

let apiServer;
const HTML_VIEW_MENU_NAME = 'Archivo';
const DIAGRAM_MENU_NAME = 'Diagramas';
const PREFERENCES_MENU_NAME = 'Preferencias';
const EXPORT_MENU_NAME = 'Espacio';
const PROMPTS_MENU_NAME = 'Prompts';
const SEARCH_PREFERENCES_FILENAME = 'search-preferences.json';
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
  mov: 'video/quicktime'
});
const closeConfirmationStates = new WeakMap();
const fileExplorerService = createFileExplorerService({ app, fs, path, shell });

// Evita un destello blanco y cierres del proceso GPU en equipos Windows sin
// un proceso de composición acelerado disponible.
app.disableHardwareAcceleration();
const SDD_SPECS_RESOURCES_DIR = 'specs_resources';
const SDD_SPECS_RESOURCES_MAX_TOTAL_BYTES = 200 * 1024 * 1024;
const SDD_SPECS_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const SDD_SPECS_VIDEO_MAX_BYTES = 100 * 1024 * 1024;
const SDD_SPECS_SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'build', 'out', 'coverage']);

function collectSpecsResourceFiles(directoryPath) {
  const resourcesDirectory = path.join(directoryPath, SDD_SPECS_RESOURCES_DIR);
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
      } else if (entry.isFile() && SDD_MEDIA_MIME_BY_EXTENSION[path.extname(entry.name).toLowerCase().replace('.', '')]) {
        found.push(entryPath);
      }
    }
  }
  return found.sort((a, b) => a.localeCompare(b));
}

function readSpecsFolderResources(directoryPath) {
  let totalBytes = 0;
  return collectSpecsResourceFiles(directoryPath).map((filePath) => {
    const stats = fs.statSync(filePath);
    const extension = path.extname(filePath).toLowerCase().replace('.', '');
    const type = SDD_MEDIA_MIME_BY_EXTENSION[extension];
    const kind = type.startsWith('video/') ? 'video' : 'image';
    const maxBytes = kind === 'video' ? SDD_SPECS_VIDEO_MAX_BYTES : SDD_SPECS_IMAGE_MAX_BYTES;
    if (stats.size > maxBytes) {
      throw new Error(`El recurso “${path.basename(filePath)}” supera el límite de ${kind === 'video' ? '100 MB' : '20 MB'}`);
    }
    totalBytes += stats.size;
    if (totalBytes > SDD_SPECS_RESOURCES_MAX_TOTAL_BYTES) throw new Error('Los recursos de specs superan el límite de 200 MB');
    const buffer = fs.readFileSync(filePath);
    return {
      name: path.basename(filePath),
      path: filePath,
      kind,
      type,
      size: stats.size,
      modifiedAt: stats.mtime.toISOString(),
      dataUrl: `data:${type};base64,${buffer.toString('base64')}`
    };
  });
}

function ensureSpecsResourcesDirectory(directoryPath) {
  const resourcesDirectory = path.join(directoryPath, SDD_SPECS_RESOURCES_DIR);
  if (!fs.existsSync(resourcesDirectory)) fs.mkdirSync(resourcesDirectory, { recursive: true });
  return resourcesDirectory;
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

function setApplicationMenuForView(window, view) {
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
        label: 'Nuevo diagrama prompt',
        click: () => window.webContents.send('html-viewer-menu-action', 'new-diagram-prompt')
      },
      {
        label: 'Analizar diff de git',
        click: () => window.webContents.send('html-viewer-menu-action', 'copy-git-diff-prompt')
      },
      {
        label: 'Generar specs.md completado',
        click: () => window.webContents.send('html-viewer-menu-action', 'copy-completed-specs-prompt')
      }
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
  window.on('closed', () => closeConfirmationStates.delete(window));
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

  ipcMain.handle('select-workspace-file', async () => {
    const result = await dialog.showOpenDialog({
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

  ipcMain.handle('save-workspace-file', async (_event, payload = {}) => {
    if (!payload || typeof payload.content !== 'string') throw new Error('El contenido del espacio de trabajo no es válido');
    if (Buffer.byteLength(payload.content, 'utf8') > WORKSPACE_MAX_FILE_BYTES) throw new Error('El espacio de trabajo supera el límite de 50 MB');
    const result = await dialog.showSaveDialog({
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

  ipcMain.handle('select-local-paths', async (_event, options = {}) => {
    const directory = Boolean(options.directory);
    const result = await dialog.showOpenDialog({
      title: directory ? 'Seleccionar carpeta con documentación' : 'Seleccionar documentos',
      properties: directory ? ['openDirectory'] : ['openFile', 'multiSelections'],
      filters: directory ? undefined : [{ name: 'Documentos compatibles', extensions: ['json', 'csv', 'txt', 'md', 'markdown', 'html', 'htm'] }]
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle('get-file-system-roots', (_event, additionalRoots) => fileExplorerService.getRoots(additionalRoots));
  ipcMain.handle('select-sdd-media', async (_event, kind = 'image') => {
    const isVideo = kind === 'video';
    const filters = isVideo
      ? [{ name: 'Vídeos', extensions: ['mp4', 'm4v', 'webm', 'ogv', 'mov'] }]
      : [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'tif', 'tiff', 'svg'] }];
    const result = await dialog.showOpenDialog({
      title: isVideo ? 'Seleccionar vídeo' : 'Seleccionar imagen',
      properties: ['openFile'],
      filters
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const filePath = path.normalize(result.filePaths[0]);
    const stats = fs.statSync(filePath);
    if (!stats.isFile()) throw new Error('La ubicación elegida no es un archivo');
    const extension = path.extname(filePath).toLowerCase().replace('.', '');
    const type = SDD_MEDIA_MIME_BY_EXTENSION[extension];
    if (!type) throw new Error('El formato del archivo no es compatible');
    const maxBytes = isVideo ? 100 * 1024 * 1024 : 20 * 1024 * 1024;
    if (stats.size > maxBytes) throw new Error(isVideo ? 'El vídeo supera el límite de 100 MB' : 'La imagen supera el límite de 20 MB');
    const buffer = fs.readFileSync(filePath);
    return { name: path.basename(filePath), type, dataUrl: `data:${type};base64,${buffer.toString('base64')}` };
  });

  ipcMain.handle('select-sdd-specs-path', async (_event, lastPath = '') => {
    const result = await dialog.showOpenDialog({
      title: 'Seleccionar carpeta de specs',
      buttonLabel: 'Inyectar',
      defaultPath: path.normalize(String(lastPath || '')),
      properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return null;
    const directoryPath = path.normalize(result.filePaths[0]);
    if (!fs.statSync(directoryPath).isDirectory()) throw new Error('La ubicación elegida no es una carpeta');
    ensureSpecsResourcesDirectory(directoryPath);
    const specsPath = path.join(directoryPath, 'specs.md');
    if (fs.existsSync(specsPath) && !fs.statSync(specsPath).isFile()) throw new Error('specs.md no es un archivo en la carpeta configurada');
    if (!fs.existsSync(specsPath)) {
      const example = `# Specs

## Requisito de ejemplo
**Estado:** borrador

Describe el requisito: contexto, criterios de aceptación, condiciones y excepciones.
`;
      fs.writeFileSync(specsPath, example, { encoding: 'utf8', mode: 0o600 });
      return { path: directoryPath, created: true };
    }
    return { path: directoryPath, created: false };
  });

  const loadSddProject = async (folderPath = '') => {
    const requestedPath = String(folderPath || '').trim();
    let directoryPath = requestedPath ? path.normalize(requestedPath) : '';
    if (!directoryPath || !fs.existsSync(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
      const result = await dialog.showOpenDialog({
        title: 'Seleccionar proyecto S.D.D',
        buttonLabel: 'Cargar',
        defaultPath: directoryPath || undefined,
        properties: ['openDirectory']
      });
      if (result.canceled || !result.filePaths[0]) return null;
      directoryPath = path.normalize(result.filePaths[0]);
    }
    if (!fs.statSync(directoryPath).isDirectory()) throw new Error('La ubicación elegida no es una carpeta');
    const specsPath = path.join(directoryPath, 'specs.md');
    if (!fs.existsSync(specsPath) || !fs.statSync(specsPath).isFile()) throw new Error('El proyecto no contiene un archivo specs.md');
    const resourcesDir = path.join(directoryPath, SDD_SPECS_RESOURCES_DIR);
    if (!fs.existsSync(resourcesDir) || !fs.statSync(resourcesDir).isDirectory()) throw new Error('El proyecto no contiene la carpeta specs_resources');
    const content = fs.readFileSync(specsPath, 'utf8');
    if (!content.trim()) throw new Error('specs.md está vacío');
    return {
      name: path.basename(directoryPath) || directoryPath,
      path: directoryPath,
      specsPath,
      resourcesPath: resourcesDir,
      content,
      resources: readSpecsFolderResources(directoryPath)
    };
  };

  ipcMain.handle('load-sdd-project', (_event, folderPath = '') => loadSddProject(folderPath));
  // Compatibilidad con versiones del renderer que todavía usan el nombre anterior.
  ipcMain.handle('load-sdd-specs-markdown', (_event, folderPath = '') => loadSddProject(folderPath));

  ipcMain.handle('read-sdd-specs-resources', (_event, folderPath = '') => {
    const directoryPath = path.normalize(String(folderPath || ''));
    if (!directoryPath || !fs.existsSync(directoryPath) || !fs.statSync(directoryPath).isDirectory()) {
      throw new Error('La carpeta de specs no es válida o ya no existe');
    }
    return { path: directoryPath, resources: readSpecsFolderResources(directoryPath) };
  });

  ipcMain.handle('list-file-system-directory', (_event, directoryPath) => fileExplorerService.listDirectory(directoryPath));
  ipcMain.handle('search-file-system', (_event, payload) => fileExplorerService.searchDirectory(payload));
  ipcMain.handle('open-file-system-entry', (_event, filePath) => fileExplorerService.openEntry(filePath));
  ipcMain.handle('create-file-system-directory', (_event, payload) => fileExplorerService.createDirectory(payload));
  ipcMain.handle('create-file-system-file', (_event, payload) => fileExplorerService.createFile(payload));
  ipcMain.handle('rename-file-system-entry', (_event, payload) => fileExplorerService.renameEntry(payload));
  ipcMain.handle('delete-file-system-entries', (_event, payload) => fileExplorerService.deleteEntries(payload));
  ipcMain.handle('transfer-file-system-entries', (_event, payload) => fileExplorerService.transferEntries(payload));

  ipcMain.handle('select-diagram-file', async () => {
    const result = await dialog.showOpenDialog({
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

  ipcMain.handle('save-diagram-file', async (_event, payload = {}) => {
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
    const result = await dialog.showSaveDialog({
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

  ipcMain.handle('create-project-directory', async () => {
    const result = await dialog.showSaveDialog({
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
