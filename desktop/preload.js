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
  loadSddLastProject: () => ipcRenderer.invoke('load-sdd-last-project'),
  saveSddLastProject: (payload) => ipcRenderer.invoke('save-sdd-last-project', payload),
  loadLastView: () => ipcRenderer.invoke('load-last-view'),
  saveLastView: (view) => ipcRenderer.invoke('save-last-view', view),
  selectWorkspaceFile: () => ipcRenderer.invoke('select-workspace-file'),
  saveWorkspaceFile: (payload) => ipcRenderer.invoke('save-workspace-file', payload),
  selectLocalPaths: (options) => ipcRenderer.invoke('select-local-paths', options),
  selectSddSpecsPath: (lastPath) => ipcRenderer.invoke('select-sdd-specs-path', lastPath),
  loadSddProject: (folderPath, options) => ipcRenderer.invoke('load-sdd-project', folderPath, options),
  loadSddSpecsMarkdown: (folderPath, options) => ipcRenderer.invoke('load-sdd-specs-markdown', folderPath, options),
  readSddSpecsResources: (folderPath) => ipcRenderer.invoke('read-sdd-specs-resources', folderPath),
  getFileSystemRoots: (additionalRoots) => ipcRenderer.invoke('get-file-system-roots', additionalRoots),
  listFileSystemDirectory: (directoryPath) => ipcRenderer.invoke('list-file-system-directory', directoryPath),
  searchFileSystem: (payload) => ipcRenderer.invoke('search-file-system', payload),
  openFileSystemEntry: (filePath) => ipcRenderer.invoke('open-file-system-entry', filePath),
  createFileSystemDirectory: (payload) => ipcRenderer.invoke('create-file-system-directory', payload),
  createFileSystemFile: (payload) => ipcRenderer.invoke('create-file-system-file', payload),
  renameFileSystemEntry: (payload) => ipcRenderer.invoke('rename-file-system-entry', payload),
  deleteFileSystemEntries: (paths) => ipcRenderer.invoke('delete-file-system-entries', paths),
  transferFileSystemEntries: (payload) => ipcRenderer.invoke('transfer-file-system-entries', payload),
  selectDiagramFile: () => ipcRenderer.invoke('select-diagram-file'),
  saveDiagramFile: (payload) => ipcRenderer.invoke('save-diagram-file', payload),
  createProjectDirectory: () => ipcRenderer.invoke('create-project-directory'),
  createSddProject: () => ipcRenderer.invoke('create-sdd-project'),
  revealFile: (filePath) => ipcRenderer.invoke('reveal-file', filePath),
  setViewMenu: (view) => ipcRenderer.invoke('set-view-menu', view),
  updatePromptMenu: (items) => ipcRenderer.invoke('update-prompt-menu', items),
  startPiTerminal: (payload) => ipcRenderer.invoke('start-pi-terminal', payload),
  stopPiTerminal: () => ipcRenderer.invoke('stop-pi-terminal'),
  sendPiTerminalMessage: (message) => ipcRenderer.invoke('send-pi-terminal-message', message),
  setPiTerminalRefreshInterval: (intervalMs) => ipcRenderer.invoke('set-pi-terminal-refresh-interval', intervalMs),
  getPiModelCatalog: () => ipcRenderer.invoke('get-pi-model-catalog'),
  onPiTerminalOutput: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('pi-terminal-output', listener);
    return () => ipcRenderer.removeListener('pi-terminal-output', listener);
  },
  onPiTerminalExit: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('pi-terminal-exit', listener);
    return () => ipcRenderer.removeListener('pi-terminal-exit', listener);
  },
  onPiTerminalError: (callback) => {
    if (typeof callback !== 'function') return () => {};
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('pi-terminal-error', listener);
    return () => ipcRenderer.removeListener('pi-terminal-error', listener);
  },
  onProjectMenuAction: (callback) => ipcRenderer.on('project-menu-action', (_event, action) => callback(action)),
  onSddMenuAction: (callback) => ipcRenderer.on('sdd-menu-action', (_event, action) => callback(action)),
  onHtmlViewerMenuAction: (callback) => ipcRenderer.on('html-viewer-menu-action', (_event, action) => callback(action)),
  onDiagramMenuAction: (callback) => ipcRenderer.on('diagram-menu-action', (_event, action) => callback(action)),
  onPreferencesMenuAction: (callback) => ipcRenderer.on('preferences-menu-action', (_event, action, value) => callback(action, value)),
  onWorkspaceMenuAction: (callback) => ipcRenderer.on('workspace-menu-action', (_event, action) => callback(action))
});
