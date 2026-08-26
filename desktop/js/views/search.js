import { $, escapeHtml } from '../core/dom.js';
import { api } from '../core/api.js';
import { OFFLINE_ONLY, persistSearchPreferences, state, resetFilters } from '../core/state.js';
import { statusLabel, typeLabel } from '../core/format.js';
import { showToast } from '../ui/notifications.js';
import { bindDocumentOpeners } from './documents.js';
import { openSourceModal } from './source-modal.js';

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

function tagOptions(selected = '') {
  return `<option value="">Todas las etiquetas</option>${state.tags.map((item) => `<option value="${escapeHtml(item.name)}" ${item.name === selected ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}`;
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
  return `<div class="filter-row"><select id="${id('source')}" class="select">${sourceOptions(filters.source)}</select><select id="${id('type')}" class="select"><option value="">Tipo</option><option value="markdown" ${filters.type === 'markdown' ? 'selected' : ''}>Markdown</option><option value="json" ${filters.type === 'json' ? 'selected' : ''}>JSON</option><option value="csv" ${filters.type === 'csv' ? 'selected' : ''}>CSV</option><option value="text" ${filters.type === 'text' ? 'selected' : ''}>TXT</option><option value="diagram" ${filters.type === 'diagram' ? 'selected' : ''}>Diagrama NexusData</option><option value="html" ${filters.type === 'html' ? 'selected' : ''}>HTML</option><option value="css" ${filters.type === 'css' ? 'selected' : ''}>CSS</option><option value="javascript" ${filters.type === 'javascript' ? 'selected' : ''}>JavaScript</option></select><select id="${id('tag')}" class="select">${tagOptions(filters.tag).replace('Todas las etiquetas', 'Etiqueta')}</select><select id="${id('collection')}" class="select">${collectionOptions(filters.collection).replace('Todas las colecciones', 'Colección')}</select><label class="form-label date-filter">Desde<input id="${id('date')}" type="date" class="field" value="${escapeHtml(filters.date)}" /></label>${commonPathsMarkup(prefix)}<button id="${prefix ? 'global-clear-filters' : 'clear-filters'}" class="btn btn-secondary btn-small">Limpiar</button></div>`;
}

function resultMarkup(results, prefix = '') {
  const resultItems = results || [];
  if (!resultItems.length) return '<div class="empty">Sin resultados</div>';
  return resultItems.map((doc) => `
    <article class="result-card document-hit" data-view-document="${escapeHtml(doc.id)}" tabindex="0" role="button" aria-label="Abrir ${escapeHtml(doc.title)}">
      <div class="result-head"><div class="doc-icon">${escapeHtml(typeLabel(doc.type))}</div><div class="result-title-wrap"><h3 class="result-title">${escapeHtml(doc.title)}</h3><div class="result-source">${escapeHtml(doc.source)}</div></div><span class="score">${Math.round((doc.score || 0) * 100)}%</span></div>
      <div class="snippet">${escapeHtml(doc.snippet || doc.content?.slice(0, 220))}</div>
      <div class="result-foot">${(doc.tags || []).map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`).join('')}<div class="result-actions"><button class="btn btn-secondary btn-small" data-${prefix ? 'global-' : ''}tag-document="${escapeHtml(doc.id)}">＋ Etiqueta</button><select class="select mini-select" data-${prefix ? 'global-' : ''}add-collection="${escapeHtml(doc.id)}"><option value="">＋ Colección</option>${collectionOptions().replace('<option value="">Todas las colecciones</option>', '')}</select></div></div>
    </article>`).join('');
}

function bindSearchControls({ prefix = '', perform, cancel, clear }) {
  const input = $(`#${prefix ? 'global-search-input' : 'search-input'}`);
  const submit = $(`#${prefix ? 'global-search-submit' : 'search-submit'}`);
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
  ['source', 'type', 'tag', 'collection', 'date'].forEach((name) => $(`#${prefix ? 'global-filter-' : 'filter-'}${name}`).addEventListener('change', () => { cancel(); perform(); }));
  commonPaths?.addEventListener('change', async () => {
    state.includeCommonPaths = commonPaths.checked;
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
      showToast(error.message, true);
    } finally {
      commonPaths.disabled = false;
    }
  });
  $(`#${prefix ? 'global-clear-filters' : 'clear-filters'}`).addEventListener('click', () => { cancel(); clear(); });
}

export function renderSearch(results = null, { restoreFocus = false, selectionStart = null, selectionEnd = null } = {}) {
  $('#view-search').innerHTML = `<div class="search-sticky"><div class="panel search-controls"><div class="search-toolbar"><div class="search-bar"><div class="search-input-wrap"><span>⌕</span><input id="search-input" class="search-input" value="${escapeHtml(state.searchQuery)}" placeholder="Buscar documentos…" autocomplete="off" /></div><button id="search-submit" class="btn btn-primary search-submit">Buscar</button></div>${filterMarkup()}</div></div></div><div class="panel search-results-panel"><div class="panel-header"><h2>Documentos</h2></div><div class="result-list">${resultMarkup(results)}</div></div>`;
  bindSearchControls({ perform: performSearch, cancel: cancelSearchDebounce, clear: () => { resetUnifiedSearch(); renderSearch([]); } });
  const surface = $('#view-search');
  bindCollectionAndTagActions(surface);
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
  const filters = { ...state.filters };
  const params = new URLSearchParams({ q: query });
  [['source', 'source'], ['type', 'type'], ['tag', 'tag'], ['collection', 'collection'], ['date', 'updatedFrom']].forEach(([name, key]) => {
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

function projectFolderName(value) { return String(value || '').split(/[\\/]/).filter(Boolean).pop() || 'Proyecto global'; }

export function renderGlobalSearch(results = null, { restoreFocus = false, selectionStart = null, selectionEnd = null } = {}) {
  const project = state.globalProject;
  const offline = OFFLINE_ONLY || state.user?.offline === true;
  const sourceActions = offline ? '<button class="btn btn-primary btn-small" data-global-source-action="new-local">＋ Carpeta local</button>' : '<button class="btn btn-secondary btn-small" data-global-source-action="new-rest">＋ API REST</button><button class="btn btn-primary btn-small" data-global-source-action="new-local">＋ Carpeta local</button>';
  const projectPanel = project
    ? `<div class="global-project-loaded"><div class="global-project-icon">⌘</div><div class="global-project-copy"><strong>${escapeHtml(project.name)}</strong><span title="${escapeHtml(project.path || '')}">${escapeHtml(project.path || 'Sin ruta')}</span><small>${escapeHtml(statusLabel(project.source.status))}</small></div></div><div class="global-project-actions">${sourceActions}<button class="btn btn-secondary btn-small" data-global-project-action="sync">↻ Actualizar recursos</button><button class="btn btn-danger btn-small" data-global-project-action="close">Cerrar proyecto</button></div>`
    : `<div class="global-project-loaded is-empty"><div class="global-project-icon">⌘</div><div class="global-project-copy"><strong>Ningún proyecto cargado</strong></div><div class="global-project-actions"><button class="btn btn-secondary" data-global-project-action="new">＋ Nuevo proyecto</button><button class="btn btn-primary" data-global-project-action="load">Cargar proyecto</button></div>`;
  $('#view-global-search').innerHTML = '<div id="global-search-controls"></div><div class="panel global-project-panel"><div class="global-project-row">' + projectPanel + '</div></div><div id="global-search-surface"></div>';
  bindGlobalProjectActions();
  bindGlobalSourceActions();
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
  surface.innerHTML = `<div class="panel search-results-panel global-documents-panel"><div class="panel-header"><h2>Documentos</h2></div><div class="result-list">${resultMarkup(results, 'global')}</div></div>`;
  bindCollectionAndTagActions(surface, 'global');
  bindDocumentOpeners(surface);
}

export function performGlobalSearch() {
  return performSearchRequest({ prefix: 'global', view: 'global-search', renderResults: renderGlobalSearchSurface });
}

function bindGlobalProjectActions() {
  document.querySelectorAll('[data-global-project-action="new"], [data-global-project-action="load"]').forEach((button) => button.addEventListener('click', () => chooseGlobalProject(button.dataset.globalProjectAction)));
  document.querySelectorAll('[data-global-project-action="sync"]').forEach((button) => button.addEventListener('click', syncGlobalProject));
  document.querySelectorAll('[data-global-project-action="close"]').forEach((button) => button.addEventListener('click', closeGlobalProject));
}

function bindGlobalSourceActions() {
  document.querySelectorAll('[data-global-source-action="new-local"]').forEach((button) => button.addEventListener('click', () => openSourceModal(null, 'local', [], '', 'global-search')));
  document.querySelectorAll('[data-global-source-action="new-rest"]').forEach((button) => button.addEventListener('click', () => openSourceModal(null, 'rest', [], '', 'global-search')));
}

async function chooseGlobalProject(mode) {
  try {
    if (typeof window.nexusData?.selectLocalPaths !== 'function') throw new Error('El selector de carpetas no está disponible');
    let projectPath = null;
    if (mode === 'new' && typeof window.nexusData?.createProjectDirectory === 'function') projectPath = await window.nexusData.createProjectDirectory();
    else projectPath = (await window.nexusData.selectLocalPaths({ directory: true }))[0] || null;
    if (!projectPath) return;
    const name = projectFolderName(projectPath);
    const result = await api('/global-project', { method: 'POST', body: JSON.stringify({ path: projectPath, name }) });
    state.globalProject = result.project;
    showToast(`${result.sync?.total || 0} recursos indexados en ${name}`);
    await refreshData();
  } catch (error) { showToast(error.message, true); }
}

async function syncGlobalProject() {
  const sourceId = state.globalProject?.source?.id;
  if (!sourceId) return;
  try { const result = await api(`/sources/${sourceId}/sync`, { method: 'POST' }); showToast(`${result.total || 0} recursos actualizados`); await refreshData(); } catch (error) { showToast(error.message, true); }
}

async function closeGlobalProject() {
  if (!state.globalProject || !window.confirm(`¿Cerrar el proyecto global “${state.globalProject.name}” y retirar sus recursos del índice?`)) return;
  try { await api('/global-project', { method: 'DELETE' }); state.globalProject = null; showToast('Proyecto global cerrado'); await refreshData(); } catch (error) { showToast(error.message, true); }
}
