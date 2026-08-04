const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const { startServer } = require('../server/app');

let apiServer;
const HTML_VIEW_MENU_NAME = 'Archivo';
const PROMPTS_MENU_NAME = 'Prompts';
const SEARCH_PREFERENCES_FILENAME = 'search-preferences.json';
const DIAGRAM_MAX_FILE_BYTES = 2 * 1024 * 1024;
const DESKTOP_PORT = Number(process.env.PORT) || 3000;
const closeConfirmationStates = new WeakMap();

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
    backgroundColor: '#09111f',
    title: 'NexusData',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true
    }
  });
  bindCloseConfirmation(window);
  window.maximize();
  setApplicationMenuForView(window, null);
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

  ipcMain.handle('select-local-paths', async (_event, options = {}) => {
    const directory = Boolean(options.directory);
    const result = await dialog.showOpenDialog({
      title: directory ? 'Seleccionar carpeta con documentación' : 'Seleccionar documentos',
      properties: directory ? ['openDirectory'] : ['openFile', 'multiSelections'],
      filters: directory ? undefined : [{ name: 'Documentos compatibles', extensions: ['json', 'csv', 'txt', 'md', 'markdown', 'html', 'htm'] }]
    });
    return result.canceled ? [] : result.filePaths;
  });

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
    if (Buffer.byteLength(payload.content, 'utf8') > DIAGRAM_MAX_FILE_BYTES) throw new Error('El diagrama supera el límite de 2 MB');
    const format = payload.format === 'json' ? 'json' : 'nxd';
    const extension = `.${format}`;
    const result = await dialog.showSaveDialog({
      title: 'Exportar diagrama',
      defaultPath: path.join(app.getPath('documents'), `diagrama${extension}`),
      filters: [{ name: format === 'json' ? 'JSON' : 'Diagrama por texto', extensions: [format] }]
    });
    if (result.canceled || !result.filePath) return null;
    let filePath = path.normalize(result.filePath);
    if (!path.extname(filePath)) filePath += extension;
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) throw new Error('La ubicación elegida es una carpeta');
    fs.writeFileSync(filePath, payload.content, { encoding: 'utf8', mode: 0o600 });
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

  ipcMain.handle('reveal-file', async (_event, filePath) => {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
      throw new Error('La ruta del documento no es válida');
    }
    const normalizedPath = path.normalize(filePath);
    if (!fs.existsSync(normalizedPath)) {
      throw new Error('El archivo ya no existe en esa ubicación');
    }
    shell.showItemInFolder(normalizedPath);
    return { ok: true };
  });

  try {
    apiServer = await startServer({
      port: DESKTOP_PORT,
      dbPath: path.join(app.getPath('userData'), 'nexusdata.db')
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
