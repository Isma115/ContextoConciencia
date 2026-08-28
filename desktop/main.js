const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const { startServer } = require('../server/app');

let apiServer;
const HTML_VIEW_MENU_NAME = 'Archivo';
const DIAGRAM_MENU_NAME = 'Diagrama';
const PREFERENCES_MENU_NAME = 'Preferencias';
const PROMPTS_MENU_NAME = 'Prompts';
const SEARCH_PREFERENCES_FILENAME = 'search-preferences.json';
const DIAGRAM_MAX_FILE_BYTES = 2 * 1024 * 1024;
const DIAGRAM_MAX_IMAGE_BYTES = 50 * 1024 * 1024;
const WORKSPACE_MAX_FILE_BYTES = 50 * 1024 * 1024;
const DESKTOP_PORT = Number(process.env.PORT) || 3000;
const OFFLINE_ONLY = true;
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

  template.push({
    label: PREFERENCES_MENU_NAME,
    submenu: [
      { label: 'Preferencias de búsqueda: activas', enabled: false },
      { type: 'separator' },
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
