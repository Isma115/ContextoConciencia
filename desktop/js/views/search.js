import { $, escapeHtml } from '../core/dom.js';
import { api } from '../core/api.js';
import { persistSearchPreferences, state, resetFilters } from '../core/state.js';
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

export function configureSearch({ onRefresh } = {}) {
  refreshData = onRefresh || refreshData;
}

function sourceOptions(selected = '') {
  return `<option value="">Todas las fuentes</option>${state.sources.map((source) => `<option value="${escapeHtml(source.id)}" ${source.id === selected ? 'selected' : ''}>${escapeHtml(source.name)}</option>`).join('')}`;
}

function collectionOptions(selected = '') {
  return `<option value="">Todas las colecciones</option>${state.collections.map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === selected ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}`;
}

function tagOptions(selected = '') {
  return `<option value="">Todas las etiquetas</option>${state.tags.map((item) => `<option value="${escapeHtml(item.name)}" ${item.name === selected ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}`;
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
  return `<div class="filter-row"><select id="${id('source')}" class="select">${sourceOptions(filters.source)}</select><select id="${id('type')}" class="select"><option value="">Tipo</option><option value="markdown" ${filters.type === 'markdown' ? 'selected' : ''}>Markdown</option><option value="json" ${filters.type === 'json' ? 'selected' : ''}>JSON</option><option value="csv" ${filters.type === 'csv' ? 'selected' : ''}>CSV</option><option value="text" ${filters.type === 'text' ? 'selected' : ''}>TXT</option><option value="diagram" ${filters.type === 'diagram' ? 'selected' : ''}>Diagrama NexusData</option><option value="html" ${filters.type === 'html' ? 'selected' : ''}>HTML</option><option value="css" ${filters.type === 'css' ? 'selected' : ''}>CSS</option><option value="javascript" ${filters.type === 'javascript' ? 'selected' : ''}>JavaScript</option><option value="rest" ${filters.type === 'rest' ? 'selected' : ''}>REST</option></select><select id="${id('tag')}" class="select">${tagOptions(filters.tag).replace('Todas las etiquetas', 'Etiqueta')}</select><select id="${id('collection')}" class="select">${collectionOptions(filters.collection).replace('Todas las colecciones', 'Colección')}</select><label class="form-label date-filter">Desde<input id="${id('date')}" type="date" class="field" value="${escapeHtml(filters.date)}" /></label><button id="${prefix ? 'global-clear-filters' : 'clear-filters'}" class="btn btn-secondary btn-small">Limpiar</button></div>`;
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
  submit.addEventListener('click', () => { cancel(); perform(); });
  input.addEventListener('input', () => {
    if (prefix) {
      state.globalSearchQuery = input.value;
      globalSearchRequestId += 1;
    } else {
      state.searchQuery = input.value;
      searchRequestId += 1;
    }
    persistSearchPreferences();
    schedule(prefix);
  });
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { cancel(); perform(); } });
  ['source', 'type', 'tag', 'collection', 'date'].forEach((name) => $(`#${prefix ? 'global-filter-' : 'filter-'}${name}`).addEventListener('change', () => { cancel(); perform(); }));
  $(`#${prefix ? 'global-clear-filters' : 'clear-filters'}`).addEventListener('click', () => { cancel(); clear(); });
}

export function renderSearch(results = null, { restoreFocus = false, selectionStart = null, selectionEnd = null } = {}) {
  $('#view-search').innerHTML = `<div class="search-sticky"><div class="panel search-controls"><div class="search-toolbar"><div class="search-bar"><div class="search-input-wrap"><span>⌕</span><input id="search-input" class="search-input" value="${escapeHtml(state.searchQuery)}" placeholder="Buscar documentos…" autocomplete="off" /></div><button id="search-submit" class="btn btn-primary search-submit">Buscar</button></div>${filterMarkup()}</div></div></div><div class="panel search-results-panel"><div class="panel-header"><h2>${state.searchQuery ? `${(results || []).length} resultados` : 'Documentos'}</h2></div><div class="result-list">${resultMarkup(results)}</div></div>`;
  bindSearchControls({ perform: performSearch, cancel: cancelSearchDebounce, clear: () => { searchRequestId += 1; state.searchQuery = ''; state.filters = resetFilters(); persistSearchPreferences(); renderSearch([]); } });
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

export async function performSearch() {
  const input = $('#search-input');
  if (!input) return;
  const restoreFocus = document.activeElement === input;
  const selectionStart = input.selectionStart;
  const selectionEnd = input.selectionEnd;
  state.searchQuery = input.value.trim();
  const requestId = ++searchRequestId;
  const params = new URLSearchParams({ q: state.searchQuery });
  [['filter-source', 'source'], ['filter-type', 'type'], ['filter-tag', 'tag'], ['filter-collection', 'collection'], ['filter-date', 'updatedFrom']].forEach(([id, key]) => { const stateKey = key === 'updatedFrom' ? 'date' : key; const value = $(`#${id}`)?.value || ''; state.filters[stateKey] = value; if (value) params.set(key, value); });
  persistSearchPreferences();
  try { const response = await api(`/search?${params}`); if (requestId === searchRequestId && state.view === 'search') renderSearch(response.results, { restoreFocus, selectionStart, selectionEnd }); } catch (error) { if (requestId === searchRequestId && state.view === 'search') showToast(error.message, true); }
}

function projectFolderName(value) { return String(value || '').split(/[\\/]/).filter(Boolean).pop() || 'Proyecto global'; }

export function renderGlobalSearch(results = null, { restoreFocus = false, selectionStart = null, selectionEnd = null } = {}) {
  const project = state.globalProject;
  const offline = state.user?.offline === true;
  const sourceActions = offline ? '<button class="btn btn-primary btn-small" data-global-source-action="new-local">＋ Carpeta local</button>' : '<button class="btn btn-secondary btn-small" data-global-source-action="new-rest">＋ API REST</button><button class="btn btn-primary btn-small" data-global-source-action="new-local">＋ Carpeta local</button>';
  const projectPanel = project
    ? `<div class="global-project-loaded"><div class="global-project-icon">⌘</div><div class="global-project-copy"><strong>${escapeHtml(project.name)}</strong><span title="${escapeHtml(project.path || '')}">${escapeHtml(project.path || 'Sin ruta')}</span><small>${project.source.documentCount} recursos indexados · ${escapeHtml(statusLabel(project.source.status))}</small></div></div><div class="global-project-actions">${sourceActions}<button class="btn btn-secondary btn-small" data-global-project-action="sync">↻ Actualizar recursos</button><button class="btn btn-danger btn-small" data-global-project-action="close">Cerrar proyecto</button></div>`
    : `<div class="global-project-loaded is-empty"><div class="global-project-icon">⌘</div><div class="global-project-copy"><strong>Ningún proyecto cargado</strong></div><div class="global-project-actions"><button class="btn btn-secondary" data-global-project-action="new">＋ Nuevo proyecto</button><button class="btn btn-primary" data-global-project-action="load">Cargar proyecto</button></div>`;
  $('#view-global-search').innerHTML = `${project ? '<div id="global-search-controls"></div>' : ''}<div class="panel global-project-panel"><div class="global-project-row">${projectPanel}</div></div>${project ? '<div id="global-search-surface"></div>' : ''}`;
  bindGlobalProjectActions();
  bindGlobalSourceActions();
  bindDocumentOpeners($('#view-global-search'));
  if (project) {
    renderGlobalSearchControls({ restoreFocus, selectionStart, selectionEnd });
    renderGlobalSearchSurface(results);
  }
}

function renderGlobalSearchControls({ restoreFocus = false, selectionStart = null, selectionEnd = null } = {}) {
  const controls = $('#global-search-controls');
  if (!controls) return;
  controls.innerHTML = `<div class="search-sticky global-search-sticky"><div class="panel search-controls"><div class="search-toolbar"><div class="search-bar"><div class="search-input-wrap"><span>⌕</span><input id="global-search-input" class="search-input" value="${escapeHtml(state.globalSearchQuery)}" placeholder="Buscar en todos los recursos…" autocomplete="off" /></div><button id="global-search-submit" class="btn btn-primary search-submit">Buscar</button></div>${filterMarkup('global', state.globalFilters)}</div></div></div>`;
  bindSearchControls({ prefix: 'global', perform: performGlobalSearch, cancel: cancelGlobalSearchDebounce, clear: () => {
    globalSearchRequestId += 1;
    state.globalSearchQuery = '';
    state.globalFilters = resetFilters();
    persistSearchPreferences();
    renderGlobalSearchControls();
    renderGlobalSearchSurface([]);
  } });
  if (restoreFocus) restoreSearchFocus($('#global-search-input'), selectionStart, selectionEnd);
}

function renderGlobalSearchSurface(results = null) {
  const surface = $('#global-search-surface');
  if (!surface) return;
  surface.innerHTML = `<div class="panel search-results-panel"><div class="panel-header"><h2>${state.globalSearchQuery ? `${(results || []).length} resultados` : 'Documentos'}</h2></div><div class="result-list">${resultMarkup(results, 'global')}</div></div>`;
  bindCollectionAndTagActions(surface, 'global');
  bindDocumentOpeners(surface);
}

export async function performGlobalSearch() {
  const input = $('#global-search-input');
  if (!input || !state.globalProject) return;
  state.globalSearchQuery = input.value.trim();
  const requestId = ++globalSearchRequestId;
  const params = new URLSearchParams({ q: state.globalSearchQuery });
  [['global-filter-source', 'source'], ['global-filter-type', 'type'], ['global-filter-tag', 'tag'], ['global-filter-collection', 'collection'], ['global-filter-date', 'updatedFrom']].forEach(([id, key]) => { const stateKey = key === 'updatedFrom' ? 'date' : key; const value = $(`#${id}`)?.value || ''; state.globalFilters[stateKey] = value; if (value) params.set(key, value); });
  persistSearchPreferences();
  try { const response = await api(`/search?${params}`); if (requestId === globalSearchRequestId && state.view === 'global-search') renderGlobalSearchSurface(response.results); } catch (error) { if (requestId === globalSearchRequestId && state.view === 'global-search') showToast(error.message, true); }
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
