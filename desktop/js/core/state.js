export const DEFAULT_FILTERS = Object.freeze({ source: '', type: '', tag: '', collection: '', date: '' });

const SEARCH_PREFERENCES_VERSION = 1;
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
  globalSearchQuery: '',
  globalFilters: { ...DEFAULT_FILTERS },
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
  user: null
};

export function resetFilters() {
  return { ...DEFAULT_FILTERS };
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

function normaliseSearchPreferences(preferences) {
  return {
    version: SEARCH_PREFERENCES_VERSION,
    searchQuery: normaliseString(preferences?.searchQuery, SEARCH_QUERY_MAX_LENGTH, true),
    filters: normaliseFilters(preferences?.filters),
    globalSearchQuery: normaliseString(preferences?.globalSearchQuery, SEARCH_QUERY_MAX_LENGTH, true),
    globalFilters: normaliseFilters(preferences?.globalFilters)
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
  return normaliseSearchPreferences({
    searchQuery: state.searchQuery,
    filters: state.filters,
    globalSearchQuery: state.globalSearchQuery,
    globalFilters: state.globalFilters
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
  state.searchQuery = restored.searchQuery;
  state.filters = restored.filters;
  state.globalSearchQuery = restored.globalSearchQuery;
  state.globalFilters = restored.globalFilters;
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
