const { contextBridge, ipcRenderer } = require('electron');

const apiArgument = process.argv.find((value) => value.startsWith('--nexusdata-api='));
const apiBase = apiArgument ? apiArgument.slice('--nexusdata-api='.length) : '';

contextBridge.exposeInMainWorld('nexusData', {
  apiBase,
  selectLocalPaths: (options) => ipcRenderer.invoke('select-local-paths', options),
  createProjectDirectory: () => ipcRenderer.invoke('create-project-directory'),
  revealFile: (filePath) => ipcRenderer.invoke('reveal-file', filePath),
  setViewMenu: (view) => ipcRenderer.invoke('set-view-menu', view),
  onHtmlViewerMenuAction: (callback) => ipcRenderer.on('html-viewer-menu-action', (_event, action) => callback(action))
});
