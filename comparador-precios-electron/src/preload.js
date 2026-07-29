const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('precioClaro', {
  getState: () => ipcRenderer.invoke('catalog:get-state'),
  addProduct: (input) => ipcRenderer.invoke('catalog:add-product', input),
  deleteProduct: (productId) => ipcRenderer.invoke('catalog:delete-product', productId),
  updateSettings: (input) => ipcRenderer.invoke('catalog:update-settings', input),
  searchOne: (productId) => ipcRenderer.invoke('catalog:search-one', productId),
  searchAll: () => ipcRenderer.invoke('catalog:search-all'),
  importCsv: () => ipcRenderer.invoke('catalog:import-csv'),
  openOffer: (url) => ipcRenderer.invoke('catalog:open-offer', url),
  onSearchProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('catalog:search-progress', listener);
    return () => ipcRenderer.removeListener('catalog:search-progress', listener);
  }
});
