const { contextBridge, ipcRenderer } = require('electron');

const apiArgument = process.argv.find((value) => value.startsWith('--nexusdata-api='));
const apiBase = apiArgument ? apiArgument.slice('--nexusdata-api='.length) : '';
let closeConfirmationCallback = null;
let closeConfirmationPending = false;

ipcRenderer.on('close-confirmation-request', () => {
  if (closeConfirmationCallback) closeConfirmationCallback();
  else closeConfirmationPending = true;
});

contextBridge.exposeInMainWorld('nexusData', {
  apiBase,
  onCloseConfirmationRequest: (callback) => {
    if (typeof callback !== 'function') return;
    closeConfirmationCallback = callback;
    if (closeConfirmationPending) {
      closeConfirmationPending = false;
      queueMicrotask(callback);
    }
  },
  resolveCloseConfirmation: (confirmed) => ipcRenderer.send('close-confirmation-result', confirmed === true),
  loadSearchPreferences: () => ipcRenderer.invoke('load-search-preferences'),
  saveSearchPreferences: (preferences) => ipcRenderer.invoke('save-search-preferences', preferences),
  selectWorkspaceFile: () => ipcRenderer.invoke('select-workspace-file'),
  saveWorkspaceFile: (payload) => ipcRenderer.invoke('save-workspace-file', payload),
  selectLocalPaths: (options) => ipcRenderer.invoke('select-local-paths', options),
  selectDiagramFile: () => ipcRenderer.invoke('select-diagram-file'),
  saveDiagramFile: (payload) => ipcRenderer.invoke('save-diagram-file', payload),
  createProjectDirectory: () => ipcRenderer.invoke('create-project-directory'),
  revealFile: (filePath) => ipcRenderer.invoke('reveal-file', filePath),
  setViewMenu: (view) => ipcRenderer.invoke('set-view-menu', view),
  onHtmlViewerMenuAction: (callback) => ipcRenderer.on('html-viewer-menu-action', (_event, action) => callback(action)),
  onDiagramMenuAction: (callback) => ipcRenderer.on('diagram-menu-action', (_event, action) => callback(action)),
  onPreferencesMenuAction: (callback) => ipcRenderer.on('preferences-menu-action', (_event, action, value) => callback(action, value))
});
