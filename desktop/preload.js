const { contextBridge, ipcRenderer } = require('electron');

const apiArgument = process.argv.find((value) => value.startsWith('--nexusdata-api='));
const apiBase = apiArgument ? apiArgument.slice('--nexusdata-api='.length) : '';

contextBridge.exposeInMainWorld('nexusData', {
  apiBase,
  selectLocalPaths: (options) => ipcRenderer.invoke('select-local-paths', options)
});
