export const DEFAULT_FILTERS = Object.freeze({ source: '', type: '', tag: '', collection: '', date: '' });
export const OFFLINE_ONLY = true;

const SEARCH_PREFERENCES_VERSION = 1;
const SIDEBAR_SEARCH_PREFERENCE_KEY = 'nexusdata.sidebar-search-expanded';
const SEARCH_QUERY_MAX_LENGTH = 500;
const FILTER_VALUE_MAX_LENGTH = 200;
const FILTER_KEYS = Object.keys(DEFAULT_FILTERS);
const BROWSER_SEARCH_PREFERENCES_KEY = 'nexusdata.search-preferences';

export const state = {
  view: 'global-search',
  sources: [],
  collections: [],
  tags: [],
  stats: { documents: 0, sources: 0, collections: 0, lastSyncAt: null },
  searchQuery: '',
  filters: { ...DEFAULT_FILTERS },
  includeCommonPaths: false,
  sidebarSearchExpanded: false,
  globalProject: null,
  htmlViewer: {
    paths: [],
    sourceId: null,
    project: null,
    selectedFile: null,
    mode: 'preview',
    loading: false,
    error: ''
  },
  codeMap: {
    files: [],
    folders: [],
    filesLoading: false,
    filesWarnings: [],
    filesFingerprint: '',
    scope: 'project',
    entryFile: '',
    entryFolder: '',
    includeExternalPackages: false,
    excludes: [],
    maxFiles: 2000,
    maxFileBytes: 2 * 1024 * 1024,
    result: null,
    loading: false,
    error: '',
    selectedId: null,
    selectedRelationId: null,
    expanded: {},
    filters: { query: '', language: '', symbolKind: '', relationKind: '' },
    groupByFolder: true,
    depth: 'files',
    zoom: 1,
    stale: false
  },
  user: null
};

export function resetFilters() {
  return { ...DEFAULT_FILTERS };
}

export function loadSidebarSearchPreference() {
  try {
    return typeof window !== 'undefined' && window.localStorage
      ? window.localStorage.getItem(SIDEBAR_SEARCH_PREFERENCE_KEY) === 'true'
      : false;
  } catch {
    return false;
  }
}

export function persistSidebarSearchPreference(expanded) {
  state.sidebarSearchExpanded = Boolean(expanded);
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(SIDEBAR_SEARCH_PREFERENCE_KEY, String(state.sidebarSearchExpanded));
    }
  } catch {
    // La búsqueda rápida sigue funcionando aunque no esté disponible el almacenamiento local.
  }
  return state.sidebarSearchExpanded;
}

function normaliseString(value, maxLength, trim = false) {
  if (typeof value !== 'string') return '';
  const normalised = value.slice(0, maxLength);
  return trim ? normalised.trim() : normalised;
}

function normaliseFilters(filters) {
  return FILTER_KEYS.reduce((result, key) => {
    result[key] = normaliseString(filters?.[key], FILTER_VALUE_MAX_LENGTH);
    return result;
  }, resetFilters());
}

function hasActiveFilters(filters) {
  return FILTER_KEYS.some((key) => Boolean(filters?.[key]));
}

function normaliseSearchPreferences(preferences) {
  return {
    version: SEARCH_PREFERENCES_VERSION,
    searchQuery: normaliseString(preferences?.searchQuery, SEARCH_QUERY_MAX_LENGTH, true),
    filters: normaliseFilters(preferences?.filters),
    globalSearchQuery: normaliseString(preferences?.globalSearchQuery, SEARCH_QUERY_MAX_LENGTH, true),
    globalFilters: normaliseFilters(preferences?.globalFilters),
    includeCommonPaths: preferences?.includeCommonPaths === true
  };
}

function browserSearchPreferences() {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    return JSON.parse(window.localStorage.getItem(BROWSER_SEARCH_PREFERENCES_KEY) || 'null');
  } catch {
    return null;
  }
}

export function getSearchPreferences() {
  const query = state.searchQuery;
  const filters = state.filters;
  return normaliseSearchPreferences({
    searchQuery: query,
    filters,
    globalSearchQuery: query,
    globalFilters: filters,
    includeCommonPaths: state.includeCommonPaths
  });
}

export async function loadSearchPreferences() {
  let preferences = null;
  try {
    if (typeof window !== 'undefined' && typeof window.nexusData?.loadSearchPreferences === 'function') {
      preferences = await window.nexusData.loadSearchPreferences();
    } else {
      preferences = browserSearchPreferences();
    }
  } catch {
    preferences = null;
  }

  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) return false;

  const restored = normaliseSearchPreferences(preferences);
  const unifiedQuery = restored.globalSearchQuery || restored.searchQuery;
  const unifiedFilters = hasActiveFilters(restored.globalFilters) ? restored.globalFilters : restored.filters;
  state.searchQuery = unifiedQuery;
  state.filters = { ...unifiedFilters };
  state.includeCommonPaths = restored.includeCommonPaths;
  return true;
}

export function persistSearchPreferences() {
  const preferences = getSearchPreferences();
  try {
    if (typeof window !== 'undefined' && typeof window.nexusData?.saveSearchPreferences === 'function') {
      Promise.resolve(window.nexusData.saveSearchPreferences(preferences)).catch(() => {});
      return;
    }
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(BROWSER_SEARCH_PREFERENCES_KEY, JSON.stringify(preferences));
    }
  } catch {
    // La persistencia no debe impedir el uso del buscador.
  }
}
