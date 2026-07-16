const path = require('node:path');
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { startServer } = require('../server/app');

let apiServer;

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
  window.loadURL(apiBase);
  return window;
}

app.whenReady().then(async () => {
  ipcMain.handle('select-local-paths', async (_event, options = {}) => {
    const directory = Boolean(options.directory);
    const result = await dialog.showOpenDialog({
      title: directory ? 'Seleccionar carpeta con documentación' : 'Seleccionar archivos técnicos',
      properties: directory ? ['openDirectory'] : ['openFile', 'multiSelections'],
      filters: directory ? undefined : [{ name: 'Archivos compatibles', extensions: ['json', 'csv', 'txt', 'md', 'markdown'] }]
    });
    return result.canceled ? [] : result.filePaths;
  });

  try {
    apiServer = await startServer({
      port: 0,
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
