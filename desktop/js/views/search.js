import { $, escapeHtml } from '../core/dom.js';
import { api } from '../core/api.js';
import { persistSearchPreferences, state, resetFilters } from '../core/state.js';
import { documentTypeClass, shortDate, sourceIcon, statusLabel, typeLabel } from '../core/format.js';
import { bindModalClose, closeModal } from '../ui/modals.js';
import { showToast } from '../ui/notifications.js';
import { bindCopyPathActions, bindDocumentFavoriteActions, bindDocumentOpeners, copyPathButtonMarkup, favoriteButtonMarkup } from './documents.js';
import { openSourceModal } from './source-modal.js';
import { deleteSource, syncSource } from './sources.js';

const SEARCH_DEBOUNCE_MS = 500;
let refreshData = async () => {};
let searchDebounceTimer = null;
let searchRequestId = 0;
let globalSearchDebounceTimer = null;
let globalSearchRequestId = 0;
let commonPathsSyncPromise = null;
let commonPathsReady = false;
let navigateToSearch = () => {};

export function configureSearch({ onRefresh, onNavigate } = {}) {
  refreshData = onRefresh || refreshData;
  navigateToSearch = onNavigate || navigateToSearch;
}

function syncSearchInputs(value) {
  document.querySelectorAll('#search-input, #global-search-input, #sidebar-search-input').forEach((input) => {
    if (input.value !== value) input.value = value;
  });
}

function syncSearchQuery(query) {
  state.searchQuery = query;
  syncSearchInputs(query);
}

function syncSearchFilters(filters) {
  const nextFilters = { ...filters };
  state.filters = nextFilters;
}

function resetUnifiedSearch() {
  searchRequestId += 1;
  globalSearchRequestId += 1;
  syncSearchQuery('');
  syncSearchFilters(resetFilters());
  state.includeCommonPaths = false;
  commonPathsReady = false;
  persistSearchPreferences();
}

function sourceOptions(selected = '') {
  const sources = state.sources.filter((source) => source.config?.role !== 'common-paths');
  return `<option value="">Todas las fuentes</option>${sources.map((source) => `<option value="${escapeHtml(source.id)}" ${source.id === selected ? 'selected' : ''}>${escapeHtml(source.name)}</option>`).join('')}`;
}

function collectionOptions(selected = '') {
  return `<option value="">Todas las colecciones</option>${state.collections.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === selected ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}`;
}

function typeOptions(selected = '') {
  return `<option value="">Tipo</option><option value="any" ${selected === 'any' ? 'selected' : ''}>Cualquier tipo de fichero</option><option value="markdown" ${selected === 'markdown' ? 'selected' : ''}>Markdown</option><option value="json" ${selected === 'json' ? 'selected' : ''}>JSON</option><option value="csv" ${selected === 'csv' ? 'selected' : ''}>CSV</option><option value="text" ${selected === 'text' ? 'selected' : ''}>TXT</option><option value="diagram" ${selected === 'diagram' ? 'selected' : ''}>Diagrama NexusData</option><option value="html" ${selected === 'html' ? 'selected' : ''}>HTML</option><option value="css" ${selected === 'css' ? 'selected' : ''}>CSS</option><option value="javascript" ${selected === 'javascript' ? 'selected' : ''}>JavaScript</option>`;
}

function commonPathsMarkup(prefix = '') {
  const id = prefix ? 'global-common-paths' : 'common-paths';
  const checked = state.includeCommonPaths ? ' checked' : '';
  return `<label class="common-paths-option" title="Busca también en Documentos, Descargas, Imágenes, Escritorio, Películas, Música, Público, Proyectos y Código"><input id="${id}" type="checkbox"${checked}><span>Rutas comunes</span><small>Documentos · Descargas · Imágenes · Escritorio · …</small></label>`;
}

export function bindSidebarSearch() {
  const input = $('#sidebar-search-input');
  if (!input || input.dataset.bound === 'true') return;
  input.dataset.bound = 'true';
  input.value = state.searchQuery;
  input.addEventListener('input', () => {
    syncSearchQuery(input.value);
    globalSearchRequestId += 1;
    persistSearchPreferences();
    if (state.view !== 'global-search') navigateToSearch('global-search');
    schedule('global');
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    cancelGlobalSearchDebounce();
    if (state.view !== 'global-search') navigateToSearch('global-search');
    performGlobalSearch();
  });
}

function bindCollectionAndTagActions(container, prefix = '') {
  const collectionSelector = prefix ? '[data-global-add-collection]' : '[data-add-collection]';
  const tagSelector = prefix ? '[data-global-tag-document]' : '[data-tag-document]';
  const collectionKey = prefix ? 'globalAddCollection' : 'addCollection';
  const tagKey = prefix ? 'globalTagDocument' : 'tagDocument';
  container.querySelectorAll(collectionSelector).forEach((select) => select.addEventListener('change', async () => {
    if (!select.value) return;
    try {
      await api(`/collections/${select.value}/items`, { method: 'POST', body: JSON.stringify({ documentId: select.dataset[collectionKey] }) });
      showToast('Documento añadido a la colección');
    } catch (error) { showToast(error.message, true); }
    select.value = '';
    await refreshData();
  }));
  container.querySelectorAll(tagSelector).forEach((button) => button.addEventListener('click', async () => {
    const name = window.prompt('Nombre de la etiqueta');
    if (!name) return;
    try {
      await api(`/documents/${button.dataset[tagKey]}/tags`, { method: 'POST', body: JSON.stringify({ name }) });
      showToast('Etiqueta guardada');
      await refreshData();
    } catch (error) { showToast(error.message, true); }
  }));
}

function filterMarkup(prefix = '', filters = state.filters) {
  const id = (name) => prefix ? `global-filter-${name}` : `filter-${name}`;
  const viewSourcesButton = prefix === 'global' ? '<button id="global-view-sources" class="btn btn-secondary btn-small source-filter-button" type="button">Ver Fuentes</button>' : '';
  const panelId = prefix ? 'global-filter-panel' : 'filter-panel';
  const toggleId = prefix ? 'global-filter-toggle' : 'filter-toggle';
  const expanded = state.searchFiltersExpanded !== false;
  const toggleLabel = expanded ? 'Ocultar filtros' : 'Mostrar filtros';
  return `<div class="filter-controls"><button id="${toggleId}" class="filter-toggle btn btn-secondary btn-small" type="button" data-filter-toggle aria-controls="${panelId}" aria-expanded="${expanded}" aria-label="${toggleLabel}" title="${toggleLabel}"><span class="filter-toggle-arrow" aria-hidden="true">${expanded ? '⌄' : '›'}</span><span>Filtros</span></button><div id="${panelId}" class="filter-panel" data-filter-panel${expanded ? '' : ' hidden'}><div class="filter-row"><select id="${id('source')}" class="select source-filter-select">${sourceOptions(filters.source)}</select>${viewSourcesButton}<select id="${id('type')}" class="select type-filter-select">${typeOptions(filters.type)}</select><label class="form-label date-filter">Desde<input id="${id('date')}" type="date" class="field" value="${escapeHtml(filters.date)}" /></label>${commonPathsMarkup(prefix)}<button id="${prefix ? 'global-clear-filters' : 'clear-filters'}" class="btn btn-secondary btn-small">Limpiar</button></div></div></div>`;
}

function resultMarkup(results, prefix = '') {
  const resultItems = results || [];
  if (!resultItems.length) return '<div class="empty">Sin resultados</div>';
  return resultItems.map((doc) => `
    <article class="result-card document-hit document-type-${documentTypeClass(doc.type)}" data-view-document="${escapeHtml(doc.id)}" tabindex="0" role="button" aria-label="Abrir ${escapeHtml(doc.title)}">
      <div class="result-head"><div class="doc-icon">${escapeHtml(typeLabel(doc.type))}</div><div class="result-title-wrap"><h3 class="result-title">${escapeHtml(doc.title)}</h3><div class="result-source">${escapeHtml(doc.source)}</div></div><span class="score">${Math.round((doc.score || 0) * 100)}%</span></div>
      <div class="snippet">${escapeHtml(doc.metadata?.contentDeferred ? 'Contenido disponible al abrir' : doc.snippet || doc.content?.slice(0, 220))}</div>
      <div class="result-foot">${(doc.tags || []).map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`).join('')}<div class="result-actions">${favoriteButtonMarkup(doc)}${copyPathButtonMarkup(doc.path)}<button class="btn btn-secondary btn-small" data-${prefix ? 'global-' : ''}tag-document="${escapeHtml(doc.id)}">＋ Etiqueta</button><select class="select mini-select" data-${prefix ? 'global-' : ''}add-collection="${escapeHtml(doc.id)}"><option value="">＋ Colección</option>${collectionOptions().replace('<option value="">Todas las colecciones</option>', '')}</select></div></div>
    </article>`).join('');
}

function bindSearchControls({ prefix = '', perform, cancel, clear }) {
  const input = $(`#${prefix ? 'global-search-input' : 'search-input'}`);
  const submit = $(`#${prefix ? 'global-search-submit' : 'search-submit'}`);
  const filterToggle = $(`#${prefix ? 'global-filter-toggle' : 'filter-toggle'}`);
  const commonPaths = $(`#${prefix ? 'global-common-paths' : 'common-paths'}`);
  submit.addEventListener('click', () => { cancel(); perform(); });
  input.addEventListener('input', () => {
    syncSearchQuery(input.value);
    if (prefix) globalSearchRequestId += 1;
    else searchRequestId += 1;
    persistSearchPreferences();
    schedule(prefix);
  });
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { cancel(); perform(); } });
  ['source', 'type', 'date'].forEach((name) => $(`#${prefix ? 'global-filter-' : 'filter-'}${name}`).addEventListener('change', () => { cancel(); perform(); }));
  filterToggle?.addEventListener('click', () => setSearchFiltersExpanded(state.searchFiltersExpanded === false));
  $(`#${prefix ? 'global-view-sources' : 'view-sources'}`)?.addEventListener('click', openSourcesModal);
  commonPaths?.addEventListener('change', async () => {
    state.includeCommonPaths = commonPaths.checked;
    persistSearchPreferences();
    cancel();
    if (!state.includeCommonPaths) {
      commonPathsReady = false;
      await perform();
      return;
    }
    commonPaths.disabled = true;
    try {
      const result = await ensureCommonPathsReady();
      showToast(result?.directories?.length ? 'Rutas comunes activadas' : 'No se encontraron rutas comunes');
      await perform();
    } catch (error) {
      state.includeCommonPaths = false;
      commonPaths.checked = false;
      persistSearchPreferences();
      showToast(error.message, true);
    } finally {
      commonPaths.disabled = false;
    }
  });
  $(`#${prefix ? 'global-clear-filters' : 'clear-filters'}`).addEventListener('click', () => { cancel(); clear(); });
}

function updateSearchFilterPanels() {
  const expanded = state.searchFiltersExpanded !== false;
  const toggleLabel = expanded ? 'Ocultar filtros' : 'Mostrar filtros';
  document.querySelectorAll('[data-filter-panel]').forEach((panel) => { panel.hidden = !expanded; });
  document.querySelectorAll('[data-filter-toggle]').forEach((toggle) => {
    toggle.setAttribute('aria-expanded', String(expanded));
    toggle.setAttribute('aria-label', toggleLabel);
    toggle.title = toggleLabel;
    const arrow = toggle.querySelector('.filter-toggle-arrow');
    if (arrow) arrow.textContent = expanded ? '⌄' : '›';
  });
}

function setSearchFiltersExpanded(expanded) {
  state.searchFiltersExpanded = Boolean(expanded);
  updateSearchFilterPanels();
  persistSearchPreferences();
}

export function renderSearch(results = null, { restoreFocus = false, selectionStart = null, selectionEnd = null } = {}) {
  $('#view-search').innerHTML = `<div class="search-sticky"><div class="panel search-controls"><div class="search-toolbar"><div class="search-bar"><div class="search-input-wrap"><span>⌕</span><input id="search-input" class="search-input" value="${escapeHtml(state.searchQuery)}" placeholder="Buscar documentos…" autocomplete="off" /></div><button id="search-submit" class="btn btn-primary search-submit">Buscar</button></div>${filterMarkup()}</div></div></div><div class="panel search-results-panel"><div class="result-list">${resultMarkup(results)}</div></div>`;
  bindSearchControls({ perform: performSearch, cancel: cancelSearchDebounce, clear: () => { resetUnifiedSearch(); renderSearch([]); } });
  const surface = $('#view-search');
  bindCollectionAndTagActions(surface);
  bindCopyPathActions(surface);
  bindDocumentFavoriteActions(surface);
  bindDocumentOpeners(surface);
  if (restoreFocus) restoreSearchFocus($('#search-input'), selectionStart, selectionEnd);
}

function restoreSearchFocus(input, selectionStart, selectionEnd) {
  input.focus();
  const start = Math.min(selectionStart ?? input.value.length, input.value.length);
  const end = Math.min(selectionEnd ?? start, input.value.length);
  input.setSelectionRange(start, end);
}

function cancelSearchDebounce() {
  if (searchDebounceTimer !== null) { clearTimeout(searchDebounceTimer); searchDebounceTimer = null; }
}

function cancelGlobalSearchDebounce() {
  if (globalSearchDebounceTimer !== null) { clearTimeout(globalSearchDebounceTimer); globalSearchDebounceTimer = null; }
}

function schedule(prefix = '') {
  const cancel = prefix ? cancelGlobalSearchDebounce : cancelSearchDebounce;
  cancel();
  const timer = setTimeout(() => {
    if (prefix) { globalSearchDebounceTimer = null; if (state.view === 'global-search') performGlobalSearch(); }
    else { searchDebounceTimer = null; if (state.view === 'search') performSearch(); }
  }, SEARCH_DEBOUNCE_MS);
  if (prefix) globalSearchDebounceTimer = timer; else searchDebounceTimer = timer;
}

function syncCommonPaths() {
  if (!commonPathsSyncPromise) {
    commonPathsSyncPromise = api('/common-paths/sync', { method: 'POST' })
      .then((result) => {
        commonPathsReady = state.includeCommonPaths;
        return result;
      })
      .catch((error) => {
        commonPathsReady = false;
        throw error;
      })
      .finally(() => { commonPathsSyncPromise = null; });
  }
  return commonPathsSyncPromise;
}

function ensureCommonPathsReady() {
  if (!state.includeCommonPaths || commonPathsReady) return Promise.resolve(null);
  return syncCommonPaths();
}

async function performSearchRequest({ prefix = '', view, renderResults }) {
  const input = $(`#${prefix ? 'global-search-input' : 'search-input'}`);
  if (!input) return;
  const restoreFocus = document.activeElement === input;
  const selectionStart = input.selectionStart;
  const selectionEnd = input.selectionEnd;
  const query = input.value.trim();
  const requestId = prefix ? ++globalSearchRequestId : ++searchRequestId;
  const filters = { ...state.filters, tag: '', collection: '' };
  const params = new URLSearchParams({ q: query });
  [['source', 'source'], ['type', 'type'], ['date', 'updatedFrom']].forEach(([name, key]) => {
    const value = $(`#${prefix ? 'global-filter-' : 'filter-'}${name}`)?.value || '';
    const stateKey = key === 'updatedFrom' ? 'date' : key;
    filters[stateKey] = value;
    if (value) params.set(key, value);
  });
  syncSearchQuery(query);
  syncSearchFilters(filters);
  persistSearchPreferences();
  try {
    await ensureCommonPathsReady();
    if (state.includeCommonPaths) params.set('includeCommonPaths', 'true');
    const response = await api(`/search?${params}`);
    const latestRequestId = prefix ? globalSearchRequestId : searchRequestId;
    if (requestId === latestRequestId && state.view === view) renderResults(response.results, { restoreFocus, selectionStart, selectionEnd });
  } catch (error) {
    const latestRequestId = prefix ? globalSearchRequestId : searchRequestId;
    if (requestId === latestRequestId && state.view === view) showToast(error.message, true);
  }
}

export function performSearch() {
  return performSearchRequest({ view: 'search', renderResults: renderSearch });
}

function globalSourceMarkup(sources) {
  if (!sources.length) return '<div class="global-sources-empty">No hay fuentes cargadas. Añade una fuente local para empezar a buscar.</div>';
  return sources.map((source) => {
    const config = source.config || {};
    const detail = source.type === 'rest' ? config.url : (config.paths || []).join(' · ');
    const sourceKind = source.type === 'rest' ? 'rest' : source.type === 'local' ? 'local' : 'generic';
    const sourceLabel = sourceKind === 'rest' ? 'API REST' : sourceKind === 'local' ? 'Archivos locales' : 'Fuente';
    return `<article class="global-source-item"><div class="global-source-main"><div class="source-logo source-logo-${sourceKind}" role="img" aria-label="${sourceLabel}" title="${sourceLabel}">${sourceIcon(sourceKind)}</div><div class="global-source-copy"><strong>${escapeHtml(source.name)}</strong><span title="${escapeHtml(detail || 'Sin configuración')}">${escapeHtml(detail || 'Sin configuración')}</span></div><span class="pill ${escapeHtml(source.status)}">${escapeHtml(statusLabel(source.status))}</span></div><div class="global-source-footer"><span>${Number(source.documentCount) || 0} docs · ${escapeHtml(shortDate(source.lastSyncAt))}</span><div class="global-source-actions"><button class="btn btn-secondary btn-small" data-global-source-action="sync" data-global-source-id="${escapeHtml(source.id)}">↻ Actualizar</button><button class="btn btn-secondary btn-small" data-global-source-action="edit" data-global-source-id="${escapeHtml(source.id)}">Editar</button><button class="btn btn-danger btn-small" data-global-source-action="delete" data-global-source-id="${escapeHtml(source.id)}">Eliminar</button></div></div></article>`;
  }).join('');
}

function availableSearchSources() {
  return state.sources.filter((source) => source.config?.role !== 'common-paths');
}

function openSourcesModal() {
  const sources = availableSearchSources();
  const sourceCount = `${sources.length} fuente${sources.length === 1 ? '' : 's'} cargada${sources.length === 1 ? '' : 's'}`;
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><div class="modal sources-modal" role="dialog" aria-modal="true" aria-labelledby="sources-modal-title"><div class="modal-head"><div><h2 id="sources-modal-title">Fuentes</h2><p>${sourceCount}.</p></div><button class="modal-close" data-close-modal aria-label="Cerrar">×</button></div><div class="modal-body sources-modal-body"><div class="global-source-list sources-modal-list">${globalSourceMarkup(sources)}</div></div><div class="modal-actions"><button class="btn btn-primary btn-small" data-global-source-action="load" type="button">＋ Cargar Fuente</button><button class="btn btn-secondary" data-close-modal type="button">Cerrar</button></div></div></div>`;
  bindModalClose();
  bindGlobalSourceActions();
}

export function renderGlobalSearch(results = null, { restoreFocus = false, selectionStart = null, selectionEnd = null } = {}) {
  $('#view-global-search').innerHTML = '<div id="global-search-controls"></div><div id="global-search-surface"></div>';
  bindDocumentOpeners($('#view-global-search'));
  renderGlobalSearchControls({ restoreFocus, selectionStart, selectionEnd });
  renderGlobalSearchSurface(results);
}

function renderGlobalSearchControls({ restoreFocus = false, selectionStart = null, selectionEnd = null } = {}) {
  const controls = $('#global-search-controls');
  if (!controls) return;
  controls.innerHTML = `<div class="search-sticky global-search-sticky"><div class="panel search-controls"><div class="search-toolbar"><div class="search-bar"><div class="search-input-wrap"><span>⌕</span><input id="global-search-input" class="search-input" value="${escapeHtml(state.searchQuery)}" placeholder="Buscar documentos…" autocomplete="off" /></div><button id="global-search-submit" class="btn btn-primary search-submit">Buscar</button></div>${filterMarkup('global', state.filters)}</div></div></div>`;
  bindSearchControls({ prefix: 'global', perform: performGlobalSearch, cancel: cancelGlobalSearchDebounce, clear: () => {
    resetUnifiedSearch();
    renderGlobalSearchControls();
    renderGlobalSearchSurface([]);
  } });
  if (restoreFocus) restoreSearchFocus($('#global-search-input'), selectionStart, selectionEnd);
}

function renderGlobalSearchSurface(results = null) {
  const surface = $('#global-search-surface');
  if (!surface) return;
  surface.innerHTML = `<div class="panel search-results-panel global-documents-panel"><div class="result-list">${resultMarkup(results, 'global')}</div></div>`;
  bindCollectionAndTagActions(surface, 'global');
  bindCopyPathActions(surface);
  bindDocumentFavoriteActions(surface);
  bindDocumentOpeners(surface);
}

export function performGlobalSearch() {
  return performSearchRequest({ prefix: 'global', view: 'global-search', renderResults: renderGlobalSearchSurface });
}

function bindGlobalSourceActions() {
  document.querySelectorAll('[data-global-source-action="load"]').forEach((button) => button.addEventListener('click', () => openSourceModal(null, 'local', [], '', 'global-search')));
  document.querySelectorAll('[data-global-source-action="sync"]').forEach((button) => button.addEventListener('click', () => { closeModal(); void syncSource(button.dataset.globalSourceId); }));
  document.querySelectorAll('[data-global-source-action="edit"]').forEach((button) => button.addEventListener('click', () => { closeModal(); openSourceModal(state.sources.find((source) => source.id === button.dataset.globalSourceId), null, [], '', 'global-search'); }));
  document.querySelectorAll('[data-global-source-action="delete"]').forEach((button) => button.addEventListener('click', () => { closeModal(); void deleteSource(button.dataset.globalSourceId); }));
}
