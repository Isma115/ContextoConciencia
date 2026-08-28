const FILE_EXPLORER_PREFERENCES_KEY = 'nexusdata.file-explorer.preferences.v1';
const SORT_FIELDS = new Set(['name', 'type', 'size', 'modified']);
const VIEW_MODES = new Set(['list', 'grid', 'details']);

function storedPreferences() {
  try {
    const raw = typeof window !== 'undefined' && window.localStorage
      ? JSON.parse(window.localStorage.getItem(FILE_EXPLORER_PREFERENCES_KEY) || 'null')
      : null;
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

function normaliseSortBy(value) {
  return typeof value === 'string' && SORT_FIELDS.has(value) ? value : 'name';
}

function normaliseSortDirection(value) {
  return value === 'desc' ? 'desc' : 'asc';
}

export function normaliseFileExplorerViewMode(value) {
  return typeof value === 'string' && VIEW_MODES.has(value) ? value : 'list';
}

export function createFileExplorerState() {
  const preferences = storedPreferences();
  return {
    roots: [],
    rootsLoaded: false,
    currentPath: null,
    parentPath: null,
    entries: [],
    totalEntries: 0,
    entriesTruncated: false,
    loading: false,
    loadingKind: '',
    errorMessage: '',
    requestId: 0,
    history: [null],
    historyIndex: 0,
    query: '',
    searchActive: false,
    searchTruncated: false,
    sortBy: normaliseSortBy(preferences.sortBy),
    sortDirection: normaliseSortDirection(preferences.sortDirection),
    viewMode: normaliseFileExplorerViewMode(preferences.viewMode),
    showHidden: preferences.showHidden === true,
    selectedPaths: new Set(),
    selectionAnchor: null,
    clipboard: { operation: '', paths: [] },
    contextMenu: null
  };
}

export function saveFileExplorerPreferences(state) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(FILE_EXPLORER_PREFERENCES_KEY, JSON.stringify({
        sortBy: normaliseSortBy(state.sortBy),
        sortDirection: normaliseSortDirection(state.sortDirection),
        viewMode: normaliseFileExplorerViewMode(state.viewMode),
        showHidden: state.showHidden === true
      }));
    }
  } catch {
    // Las preferencias siguen activas durante la sesión aunque no se puedan guardar.
  }
}

export function clearFileExplorerSelection(state) {
  state.selectedPaths.clear();
  state.selectionAnchor = null;
}

export function selectedFileExplorerPaths(state) {
  return [...state.selectedPaths];
}

export function pushFileExplorerHistory(state, location) {
  if (state.history[state.historyIndex] === location) return;
  state.history = state.history.slice(0, state.historyIndex + 1);
  state.history.push(location);
  state.historyIndex = state.history.length - 1;
}

export function setFileExplorerHistoryIndex(state, index) {
  state.historyIndex = Math.max(0, Math.min(state.history.length - 1, Number(index) || 0));
}

export function resetFileExplorerDirectory(state, { clearHistory = false } = {}) {
  state.currentPath = null;
  state.parentPath = null;
  state.entries = [];
  state.totalEntries = 0;
  state.entriesTruncated = false;
  state.query = '';
  state.searchActive = false;
  state.searchTruncated = false;
  state.errorMessage = '';
  state.contextMenu = null;
  clearFileExplorerSelection(state);
  if (clearHistory) {
    state.history = [null];
    state.historyIndex = 0;
  }
}

export function applyFileExplorerDirectoryResult(state, result, fallbackPath) {
  state.currentPath = result?.path || fallbackPath;
  state.parentPath = result?.parentPath || state.currentPath;
  state.entries = Array.isArray(result?.entries) ? result.entries : [];
  state.totalEntries = Number(result?.total) || state.entries.length;
  state.entriesTruncated = result?.truncated === true;
  state.query = '';
  state.searchActive = false;
  state.searchTruncated = false;
  state.errorMessage = '';
  state.contextMenu = null;
  clearFileExplorerSelection(state);
}

export function applyFileExplorerSearchResult(state, result, fallbackPath, query) {
  state.currentPath = result?.path || fallbackPath;
  state.parentPath = result?.parentPath || state.currentPath;
  state.entries = Array.isArray(result?.entries) ? result.entries : [];
  state.totalEntries = Number(result?.total) || state.entries.length;
  state.entriesTruncated = result?.truncated === true;
  state.query = query;
  state.searchActive = true;
  state.searchTruncated = result?.truncated === true;
  state.errorMessage = '';
  state.contextMenu = null;
  clearFileExplorerSelection(state);
}
