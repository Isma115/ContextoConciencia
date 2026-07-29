export const DEFAULT_FILTERS = Object.freeze({ source: '', type: '', tag: '', collection: '', date: '' });

export const state = {
  view: 'global-search',
  sources: [],
  collections: [],
  tags: [],
  searchQuery: '',
  filters: { ...DEFAULT_FILTERS },
  globalSearchQuery: '',
  globalFilters: { ...DEFAULT_FILTERS },
  globalProject: null,
  htmlViewer: {
    paths: [],
    project: null,
    selectedFile: null,
    mode: 'preview',
    loading: false
  },
  user: null
};

export function resetFilters() {
  return { ...DEFAULT_FILTERS };
}
