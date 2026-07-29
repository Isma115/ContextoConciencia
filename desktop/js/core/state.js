export const DEFAULT_FILTERS = Object.freeze({ source: '', type: '', tag: '', collection: '', date: '' });

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
