function explorerApi() {
  return typeof window !== 'undefined' ? window.nexusData : null;
}

function requireOperation(name) {
  const api = explorerApi();
  if (typeof api?.[name] !== 'function') throw new Error('El explorador local requiere la aplicación de escritorio');
  return api[name];
}

export const fileExplorerOperations = Object.freeze({
  getRoots: (additionalRoots) => requireOperation('getFileSystemRoots')(additionalRoots),
  listDirectory: (directoryPath) => requireOperation('listFileSystemDirectory')(directoryPath),
  searchDirectory: (payload) => requireOperation('searchFileSystem')(payload),
  openEntry: (filePath) => requireOperation('openFileSystemEntry')(filePath),
  revealEntry: (filePath) => requireOperation('revealFile')(filePath),
  createDirectory: (payload) => requireOperation('createFileSystemDirectory')(payload),
  createFile: (payload) => requireOperation('createFileSystemFile')(payload),
  renameEntry: (payload) => requireOperation('renameFileSystemEntry')(payload),
  deleteEntries: (paths) => requireOperation('deleteFileSystemEntries')(paths),
  transferEntries: (payload) => requireOperation('transferFileSystemEntries')(payload)
});

export async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const helper = document.createElement('textarea');
  helper.value = text;
  helper.setAttribute('readonly', '');
  helper.style.position = 'fixed';
  helper.style.opacity = '0';
  document.body.appendChild(helper);
  helper.select();
  const copied = document.execCommand('copy');
  helper.remove();
  if (!copied) throw new Error('El portapapeles no está disponible');
}
