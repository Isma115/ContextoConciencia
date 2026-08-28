import { $ } from '../core/dom.js';
import { showToast } from '../ui/notifications.js';
import { openFileExplorerDeleteDialog, openFileExplorerNameDialog } from './file-explorer-dialogs.js';
import { copyTextToClipboard, fileExplorerOperations } from './file-explorer-operations.js';
import { selectedFileExplorerPaths, createFileExplorerState, applyFileExplorerDirectoryResult, applyFileExplorerSearchResult, clearFileExplorerSelection, normaliseFileExplorerViewMode, pushFileExplorerHistory, resetFileExplorerDirectory, saveFileExplorerPreferences, setFileExplorerHistoryIndex } from './file-explorer-state.js';
import { visibleFileExplorerEntries } from './file-explorer-format.js';
import { renderFileExplorerView } from './file-explorer-render.js';

const explorerState = createFileExplorerState();
let boundContainer = null;

function redraw() {
  if (boundContainer) renderFileExplorerView(boundContainer, explorerState);
}

function operationError(error, fallback) {
  showToast(error?.message || fallback, true);
}

function clearContextMenu() {
  if (!explorerState.contextMenu) return;
  explorerState.contextMenu = null;
  redraw();
}

function resetLoadingState() {
  explorerState.loading = false;
  explorerState.loadingKind = '';
}

async function loadRoots({ force = false, recordHistory = false } = {}) {
  if (explorerState.loading) return;
  if (!force && explorerState.rootsLoaded) {
    goHome({ recordHistory });
    return;
  }
  const activeRequestId = ++explorerState.requestId;
  explorerState.loading = true;
  explorerState.loadingKind = 'roots';
  explorerState.errorMessage = '';
  explorerState.contextMenu = null;
  redraw();
  try {
    const result = await fileExplorerOperations.getRoots();
    if (activeRequestId !== explorerState.requestId) return;
    explorerState.roots = Array.isArray(result) ? result : [];
    explorerState.rootsLoaded = true;
    explorerState.errorMessage = '';
  } catch (error) {
    if (activeRequestId === explorerState.requestId) explorerState.errorMessage = error.message || 'No se pudieron cargar las ubicaciones locales';
  } finally {
    if (activeRequestId === explorerState.requestId) {
      resetLoadingState();
      redraw();
    }
  }
}

async function loadDirectory(directoryPath, { historyMode = 'push', historyIndex = null, previousHistoryIndex = explorerState.historyIndex } = {}) {
  const requestedPath = String(directoryPath || '').trim();
  if (!requestedPath || explorerState.loading) return;
  const activeRequestId = ++explorerState.requestId;
  explorerState.loading = true;
  explorerState.loadingKind = 'directory';
  explorerState.errorMessage = '';
  explorerState.currentPath = requestedPath;
  explorerState.parentPath = null;
  explorerState.entries = [];
  explorerState.totalEntries = 0;
  explorerState.entriesTruncated = false;
  explorerState.query = '';
  explorerState.searchActive = false;
  explorerState.searchTruncated = false;
  explorerState.contextMenu = null;
  clearFileExplorerSelection(explorerState);
  redraw();
  try {
    const result = await fileExplorerOperations.listDirectory(requestedPath);
    if (activeRequestId !== explorerState.requestId) return;
    applyFileExplorerDirectoryResult(explorerState, result, requestedPath);
    if (historyMode === 'push') pushFileExplorerHistory(explorerState, explorerState.currentPath);
    if (historyMode === 'set' && historyIndex !== null) setFileExplorerHistoryIndex(explorerState, historyIndex);
  } catch (error) {
    if (activeRequestId === explorerState.requestId) {
      explorerState.errorMessage = error.message || 'No se pudo leer esta carpeta';
      if (historyMode === 'set') setFileExplorerHistoryIndex(explorerState, previousHistoryIndex);
    }
  } finally {
    if (activeRequestId === explorerState.requestId) {
      resetLoadingState();
      redraw();
    }
  }
}

async function searchCurrentDirectory(query = explorerState.query) {
  if (!explorerState.currentPath || explorerState.loading) return;
  const value = String(query || '').trim();
  if (!value) {
    await loadDirectory(explorerState.currentPath, { historyMode: 'none' });
    return;
  }
  const basePath = explorerState.currentPath;
  const activeRequestId = ++explorerState.requestId;
  explorerState.loading = true;
  explorerState.loadingKind = 'search';
  explorerState.errorMessage = '';
  explorerState.query = value;
  explorerState.searchActive = true;
  explorerState.searchTruncated = false;
  explorerState.entries = [];
  explorerState.totalEntries = 0;
  explorerState.contextMenu = null;
  clearFileExplorerSelection(explorerState);
  redraw();
  try {
    const result = await fileExplorerOperations.searchDirectory({ directoryPath: basePath, query: value, includeHidden: explorerState.showHidden });
    if (activeRequestId !== explorerState.requestId) return;
    applyFileExplorerSearchResult(explorerState, result, basePath, value);
  } catch (error) {
    if (activeRequestId === explorerState.requestId) explorerState.errorMessage = error.message || 'No se pudo buscar en esta carpeta';
  } finally {
    if (activeRequestId === explorerState.requestId) {
      resetLoadingState();
      redraw();
    }
  }
}

async function reloadCurrentLocation() {
  if (!explorerState.currentPath) {
    await loadRoots({ force: true });
    return;
  }
  if (explorerState.searchActive && explorerState.query) {
    await searchCurrentDirectory(explorerState.query);
    return;
  }
  await loadDirectory(explorerState.currentPath, { historyMode: 'none' });
}

function goHome({ recordHistory = true } = {}) {
  if (explorerState.loading) return;
  explorerState.requestId += 1;
  resetFileExplorerDirectory(explorerState);
  if (recordHistory) pushFileExplorerHistory(explorerState, null);
  redraw();
  if (!explorerState.rootsLoaded) void loadRoots();
}

function goBack() {
  if (explorerState.loading || explorerState.historyIndex <= 0) return;
  const previousIndex = explorerState.historyIndex;
  const targetIndex = previousIndex - 1;
  const target = explorerState.history[targetIndex];
  if (target === null) {
    setFileExplorerHistoryIndex(explorerState, targetIndex);
    goHome({ recordHistory: false });
    return;
  }
  void loadDirectory(target, { historyMode: 'set', historyIndex: targetIndex, previousHistoryIndex: previousIndex });
}

function goForward() {
  if (explorerState.loading || explorerState.historyIndex >= explorerState.history.length - 1) return;
  const previousIndex = explorerState.historyIndex;
  const targetIndex = previousIndex + 1;
  const target = explorerState.history[targetIndex];
  if (target === null) {
    setFileExplorerHistoryIndex(explorerState, targetIndex);
    goHome({ recordHistory: false });
    return;
  }
  void loadDirectory(target, { historyMode: 'set', historyIndex: targetIndex, previousHistoryIndex: previousIndex });
}

function goParent() {
  if (explorerState.parentPath && explorerState.parentPath !== explorerState.currentPath) void loadDirectory(explorerState.parentPath);
}

function entryForPath(filePath) {
  return explorerState.entries.find((entry) => entry.path === filePath) || null;
}

function selectedEntries() {
  const selected = explorerState.selectedPaths;
  return explorerState.entries.filter((entry) => selected.has(entry.path));
}

function selectEntry(entryElement, event) {
  const filePath = entryElement.dataset.fileExplorerEntry;
  if (!filePath) return;
  const orderedEntries = visibleFileExplorerEntries(explorerState);
  const entryIndex = orderedEntries.findIndex((entry) => entry.path === filePath);
  const anchorIndex = orderedEntries.findIndex((entry) => entry.path === explorerState.selectionAnchor);
  const additive = event.ctrlKey || event.metaKey;
  if (event.shiftKey && anchorIndex >= 0 && entryIndex >= 0) {
    const rangeStart = Math.min(anchorIndex, entryIndex);
    const rangeEnd = Math.max(anchorIndex, entryIndex);
    const next = additive ? new Set(explorerState.selectedPaths) : new Set();
    orderedEntries.slice(rangeStart, rangeEnd + 1).forEach((entry) => next.add(entry.path));
    explorerState.selectedPaths = next;
  } else if (additive) {
    const next = new Set(explorerState.selectedPaths);
    if (next.has(filePath)) next.delete(filePath);
    else next.add(filePath);
    explorerState.selectedPaths = next;
    explorerState.selectionAnchor = filePath;
  } else {
    explorerState.selectedPaths = new Set([filePath]);
    explorerState.selectionAnchor = filePath;
  }
  explorerState.contextMenu = null;
  redraw();
}

function selectAllEntries() {
  if (!explorerState.currentPath) return;
  explorerState.selectedPaths = new Set(visibleFileExplorerEntries(explorerState).map((entry) => entry.path));
  explorerState.selectionAnchor = [...explorerState.selectedPaths][0] || null;
  redraw();
}

function openEntry(entry) {
  if (!entry) return;
  if (entry.kind === 'directory') {
    void loadDirectory(entry.path);
    return;
  }
  fileExplorerOperations.openEntry(entry.path).catch((error) => operationError(error, 'No se pudo abrir el fichero'));
}

function copySelectedEntries(operation) {
  const paths = selectedFileExplorerPaths(explorerState);
  if (!paths.length) return;
  explorerState.clipboard = { operation, paths };
  explorerState.contextMenu = null;
  redraw();
}

async function runMutation(task) {
  if (explorerState.loading) return;
  explorerState.loading = true;
  explorerState.loadingKind = 'operation';
  explorerState.errorMessage = '';
  explorerState.contextMenu = null;
  redraw();
  try {
    return await task();
  } finally {
    resetLoadingState();
    redraw();
  }
}

async function pasteEntries() {
  if (!explorerState.currentPath || !explorerState.clipboard.paths.length) return;
  const clipboard = { ...explorerState.clipboard, paths: [...explorerState.clipboard.paths] };
  try {
    await runMutation(() => fileExplorerOperations.transferEntries({
      sourcePaths: clipboard.paths,
      destinationPath: explorerState.currentPath,
      operation: clipboard.operation
    }));
    if (clipboard.operation === 'cut') explorerState.clipboard = { operation: '', paths: [] };
    clearFileExplorerSelection(explorerState);
    await reloadCurrentLocation();
  } catch (error) {
    operationError(error, 'No se pudieron pegar los elementos');
  }
}

function openNewNameDialog({ type, title, label, placeholder, submitLabel }) {
  if (!explorerState.currentPath) return;
  openFileExplorerNameDialog({
    title,
    label,
    placeholder,
    submitLabel,
    onSubmit: async (name) => {
      await runMutation(() => type === 'folder'
        ? fileExplorerOperations.createDirectory({ parentPath: explorerState.currentPath, name })
        : fileExplorerOperations.createFile({ parentPath: explorerState.currentPath, name }));
      clearFileExplorerSelection(explorerState);
      await reloadCurrentLocation();
    }
  });
}

function renameSelectedEntry() {
  const entry = selectedEntries()[0];
  if (!entry || explorerState.selectedPaths.size !== 1) return;
  openFileExplorerNameDialog({
    title: 'Renombrar elemento',
    label: 'Nuevo nombre',
    value: entry.name,
    submitLabel: 'Renombrar',
    onSubmit: async (name) => {
      await runMutation(() => fileExplorerOperations.renameEntry({ path: entry.path, name }));
      clearFileExplorerSelection(explorerState);
      await reloadCurrentLocation();
    }
  });
}

function deleteSelectedEntries() {
  const entries = selectedEntries();
  if (!entries.length) return;
  const paths = entries.map((entry) => entry.path);
  openFileExplorerDeleteDialog({
    names: entries.map((entry) => entry.name),
    onConfirm: async () => {
      await runMutation(() => fileExplorerOperations.deleteEntries(paths));
      clearFileExplorerSelection(explorerState);
      explorerState.clipboard.paths = explorerState.clipboard.paths.filter((path) => !paths.includes(path));
      await reloadCurrentLocation();
    }
  });
}

async function copySelectedPaths() {
  const paths = selectedFileExplorerPaths(explorerState);
  if (!paths.length) return;
  try {
    await copyTextToClipboard(paths.join('\n'));
  } catch (error) {
    operationError(error, 'No se pudieron copiar las rutas');
  }
}

async function revealSelectedEntry() {
  const entry = selectedEntries()[0];
  if (!entry) return;
  try {
    await fileExplorerOperations.revealEntry(entry.path);
  } catch (error) {
    operationError(error, 'No se pudo mostrar el elemento en el sistema');
  }
}

function contextPath() {
  return explorerState.contextMenu?.path || selectedFileExplorerPaths(explorerState)[0] || '';
}

async function handleContextAction(action) {
  const filePath = contextPath();
  explorerState.contextMenu = null;
  redraw();
  if (action === 'context-open') openEntry(entryForPath(filePath));
  if (action === 'context-copy') copySelectedEntries('copy');
  if (action === 'context-cut') copySelectedEntries('cut');
  if (action === 'context-copy-path') await copySelectedPaths();
  if (action === 'context-reveal') await revealSelectedEntry();
  if (action === 'context-rename') renameSelectedEntry();
  if (action === 'context-delete') deleteSelectedEntries();
  if (action === 'context-new-folder') openNewNameDialog({ type: 'folder', title: 'Nueva carpeta', label: 'Nombre de la carpeta', placeholder: 'Nueva carpeta', submitLabel: 'Crear' });
  if (action === 'context-new-file') openNewNameDialog({ type: 'file', title: 'Nuevo fichero', label: 'Nombre del fichero', placeholder: 'notas.txt', submitLabel: 'Crear' });
  if (action === 'context-paste') await pasteEntries();
}

async function handleAction(action, target) {
  if (action === 'back') goBack();
  if (action === 'forward') goForward();
  if (action === 'home') goHome();
  if (action === 'parent') goParent();
  if (action === 'refresh') await reloadCurrentLocation();
  if (action === 'open-root' || action === 'open-path') void loadDirectory(target.dataset.fileExplorerPath);
  if (action === 'clear-search') void loadDirectory(explorerState.currentPath, { historyMode: 'none' });
  if (action === 'sort-direction') {
    explorerState.sortDirection = explorerState.sortDirection === 'asc' ? 'desc' : 'asc';
    saveFileExplorerPreferences(explorerState);
    redraw();
  }
  if (action === 'view-mode') {
    explorerState.viewMode = normaliseFileExplorerViewMode(target.dataset.fileExplorerViewMode);
    saveFileExplorerPreferences(explorerState);
    redraw();
  }
  if (action === 'new-folder') openNewNameDialog({ type: 'folder', title: 'Nueva carpeta', label: 'Nombre de la carpeta', placeholder: 'Nueva carpeta', submitLabel: 'Crear' });
  if (action === 'new-file') openNewNameDialog({ type: 'file', title: 'Nuevo fichero', label: 'Nombre del fichero', placeholder: 'notas.txt', submitLabel: 'Crear' });
  if (action === 'rename') renameSelectedEntry();
  if (action === 'copy') copySelectedEntries('copy');
  if (action === 'cut') copySelectedEntries('cut');
  if (action === 'paste') await pasteEntries();
  if (action === 'copy-path') await copySelectedPaths();
  if (action === 'reveal') await revealSelectedEntry();
  if (action === 'delete') deleteSelectedEntries();
}

function handleEntryContextMenu(event, entryElement) {
  event.preventDefault();
  const filePath = entryElement.dataset.fileExplorerEntry;
  if (!explorerState.selectedPaths.has(filePath)) {
    explorerState.selectedPaths = new Set([filePath]);
    explorerState.selectionAnchor = filePath;
  }
  explorerState.contextMenu = { x: event.clientX, y: event.clientY, path: filePath };
  redraw();
}

function handleKeydown(event) {
  const textControl = event.target.closest?.('input, textarea, select, [contenteditable="true"]');
  if (textControl) return;
  const modifier = event.ctrlKey || event.metaKey;
  const key = String(event.key || '').toLowerCase();
  if (event.altKey && key === 'arrowleft') {
    event.preventDefault();
    goBack();
    return;
  }
  if (event.altKey && key === 'arrowright') {
    event.preventDefault();
    goForward();
    return;
  }
  if (modifier && key === 'a') {
    event.preventDefault();
    selectAllEntries();
    return;
  }
  if (modifier && key === 'c') {
    event.preventDefault();
    copySelectedEntries('copy');
    return;
  }
  if (modifier && key === 'x') {
    event.preventDefault();
    copySelectedEntries('cut');
    return;
  }
  if (modifier && key === 'v') {
    event.preventDefault();
    void pasteEntries();
    return;
  }
  if (key === 'f2') {
    event.preventDefault();
    renameSelectedEntry();
    return;
  }
  if (key === 'delete') {
    event.preventDefault();
    deleteSelectedEntries();
    return;
  }
  if (key === 'backspace') {
    event.preventDefault();
    goParent();
  }
}

function bindFileExplorerEvents(container) {
  if (container.dataset.fileExplorerBound === 'true') return;
  container.dataset.fileExplorerBound = 'true';
  container.addEventListener('click', (event) => {
    const contextAction = event.target.closest?.('[data-file-explorer-context-action]');
    if (contextAction) {
      void handleContextAction(contextAction.dataset.fileExplorerContextAction);
      return;
    }
    if (explorerState.contextMenu && !event.target.closest('.file-explorer-context-menu')) explorerState.contextMenu = null;
    const actionTarget = event.target.closest?.('[data-file-explorer-action]');
    if (actionTarget && container.contains(actionTarget) && !actionTarget.disabled) {
      const action = actionTarget.dataset.fileExplorerAction;
      if (action === 'toggle-hidden') return;
      void handleAction(action, actionTarget);
      return;
    }
    const entry = event.target.closest?.('[data-file-explorer-entry]');
    if (entry && container.contains(entry) && !explorerState.loading) selectEntry(entry, event);
    if (explorerState.contextMenu) redraw();
  });
  container.addEventListener('dblclick', (event) => {
    const entryElement = event.target.closest?.('[data-file-explorer-entry]');
    if (!entryElement || explorerState.loading) return;
    openEntry(entryForPath(entryElement.dataset.fileExplorerEntry));
  });
  container.addEventListener('contextmenu', (event) => {
    const entryElement = event.target.closest?.('[data-file-explorer-entry]');
    if (entryElement) {
      handleEntryContextMenu(event, entryElement);
      return;
    }
    if (event.target.closest('.file-explorer-content') && explorerState.currentPath) {
      event.preventDefault();
      explorerState.contextMenu = { x: event.clientX, y: event.clientY, path: null };
      redraw();
    }
  });
  container.addEventListener('submit', (event) => {
    if (event.target.id === 'file-explorer-path-form') {
      event.preventDefault();
      const input = $('#file-explorer-path', event.target);
      if (input?.value.trim()) void loadDirectory(input.value);
      return;
    }
    if (event.target.id === 'file-explorer-search-form') {
      event.preventDefault();
      const input = $('#file-explorer-search', event.target);
      void searchCurrentDirectory(input?.value || '');
    }
  });
  container.addEventListener('change', (event) => {
    if (event.target.matches('[data-file-explorer-action="sort"]')) {
      explorerState.sortBy = event.target.value;
      saveFileExplorerPreferences(explorerState);
      redraw();
    }
    if (event.target.matches('[data-file-explorer-action="toggle-hidden"]')) {
      explorerState.showHidden = event.target.checked;
      clearFileExplorerSelection(explorerState);
      saveFileExplorerPreferences(explorerState);
      if (explorerState.searchActive && explorerState.query) void searchCurrentDirectory(explorerState.query);
      else redraw();
    }
  });
  container.addEventListener('keydown', handleKeydown);
  document.addEventListener('keydown', (event) => {
    if (explorerState.contextMenu && event.key === 'Escape') clearContextMenu();
  });
}

export function renderFileExplorer() {
  const container = $('#view-file-explorer');
  if (!container) return;
  boundContainer = container;
  bindFileExplorerEvents(container);
  renderFileExplorerView(container, explorerState);
  if (!explorerState.rootsLoaded && !explorerState.loading && !explorerState.currentPath && !explorerState.errorMessage) void loadRoots();
}
