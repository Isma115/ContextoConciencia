import { $, escapeHtml } from '../core/dom.js';
import { api } from '../core/api.js';
import { sectionIconMarkup } from '../core/section-icons.js';
import { showToast } from '../ui/notifications.js';
import { closeModal, bindModalClose } from '../ui/modals.js';
import { shortDate } from '../core/format.js';
import { state } from '../core/state.js';
import { persistSddPromptIncludeFull, readStoredSddPromptIncludeFull, persistSddPromptSkipTests, readStoredSddPromptSkipTests } from './specs-prompt.js';

const SPEC_STATUS = Object.freeze({ active: 'Activa', implemented: 'Implementada' });
const SPEC_CATEGORIES = Object.freeze(['Funcional', 'Usabilidad', 'Base de datos', 'Seguridad', 'Rendimiento', 'Integración']);
const SPEC_CARD_COLORS = Object.freeze([
  { id: 'red', label: 'Rojo' },
  { id: 'coral', label: 'Coral' },
  { id: 'orange', label: 'Naranja' },
  { id: 'amber', label: 'Ámbar' },
  { id: 'yellow', label: 'Amarillo' },
  { id: 'lime', label: 'Lima' },
  { id: 'green', label: 'Verde' },
  { id: 'teal', label: 'Turquesa' },
  { id: 'cyan', label: 'Cian' },
  { id: 'blue', label: 'Azul' },
  { id: 'indigo', label: 'Índigo' },
  { id: 'violet', label: 'Violeta' },
  { id: 'purple', label: 'Morado' },
  { id: 'fuchsia', label: 'Fucsia' },
  { id: 'pink', label: 'Rosa' },
  { id: 'rose', label: 'Rosado' }
]);
const MEDIA_KIND = Object.freeze({ text: 'Texto', image: 'Imagen', video: 'Vídeo', audio: 'Audio' });
const SDD_FILTER_NONE = '__none__';
const SDD_FILTER_DEFINITIONS = Object.freeze({
  specs: [
    { id: 'sdd-spec-status-filter', field: 'status', label: 'Estado', allLabel: 'Todos los estados', options: Object.entries(SPEC_STATUS).map(([value, label]) => ({ value, label })) },
    { id: 'sdd-spec-category-filter', field: 'category', label: 'Categoría', allLabel: 'Todas las categorías', options: [] }
  ],
  database: [
    { id: 'sdd-db-columns-filter', field: 'columns', label: 'Columnas', allLabel: 'Todas las tablas', options: [{ value: 'with-columns', label: 'Con columnas' }, { value: 'without-columns', label: 'Sin columnas' }] }
  ],
  ui: [
    { id: 'sdd-ui-kind-filter', field: 'kind', label: 'Tipo', allLabel: 'Todos los tipos', options: Object.entries(MEDIA_KIND).map(([value, label]) => ({ value, label })) }
  ],
  resources: [
    { id: 'sdd-resource-kind-filter', field: 'kind', label: 'Tipo', allLabel: 'Todos los tipos', options: Object.entries(MEDIA_KIND).filter(([value]) => value !== 'text').map(([value, label]) => ({ value, label })) }
  ]
});
const SDD_SORT_DEFINITIONS = Object.freeze({
  specs: [
    { value: '', label: 'Orden original' },
    { value: 'title-asc', label: 'Título A–Z' },
    { value: 'updated-desc', label: 'Actualizadas primero' },
    { value: 'color-asc', label: 'Color' }
  ],
  database: [
    { value: '', label: 'Orden original' },
    { value: 'name-asc', label: 'Nombre A–Z' },
    { value: 'columns-desc', label: 'Más columnas primero' },
    { value: 'updated-desc', label: 'Actualizadas primero' }
  ],
  ui: [
    { value: '', label: 'Orden original' },
    { value: 'title-asc', label: 'Título A–Z' },
    { value: 'updated-desc', label: 'Actualizados primero' }
  ],
  resources: [
    { value: '', label: 'Orden original' },
    { value: 'name-asc', label: 'Nombre A–Z' },
    { value: 'size-desc', label: 'Mayor tamaño primero' },
    { value: 'modified-desc', label: 'Modificados recientemente' }
  ]
});
const SPECS_FOLDER_NAME = 'SDD_specs';
const SPECS_FILE_NAME = 'specs.md';
const SPECS_FULL_FILE_NAME = 'specs_full.md';
const SPECS_RESOURCES_FOLDER_NAME = 'specs_resources';
const SDD_PROJECT_PATH_STORAGE_KEY = 'nexusdata.sdd-project-path.v1';
const SDD_LAST_PROJECT_STORAGE_KEY = 'nexusdata.sdd-last-project';
const SDD_SPECS_FILTERS_STORAGE_KEY = 'nexusdata.sdd-specs-filters.v1';
// Solo se guardan los combobox de la vista de Specs: estado, categoría y orden.
const SDD_SPECS_STORED_SELECT_FIELDS = Object.freeze(['status', 'category', 'sort']);

function readStoredSddSpecsFilters() {
  const stored = { status: '', category: '', sort: '' };
  try {
    if (typeof window === 'undefined' || !window.localStorage) return stored;
    const value = JSON.parse(window.localStorage.getItem(SDD_SPECS_FILTERS_STORAGE_KEY) || 'null');
    if (!value || typeof value !== 'object' || Array.isArray(value)) return stored;
    const statusValues = Object.keys(SPEC_STATUS);
    const sortValues = (SDD_SORT_DEFINITIONS.specs || []).map((option) => String(option.value));
    const status = String(value.status ?? '').trim();
    const category = String(value.category ?? '').trim().slice(0, 120);
    const sort = String(value.sort ?? '').trim();
    if (statusValues.includes(status)) stored.status = status;
    // La categoría puede venir de los propios specs, así que solo se exige que sea texto.
    if (category && category !== SDD_FILTER_NONE) stored.category = category;
    if (sortValues.includes(sort)) stored.sort = sort;
  } catch {
    return { status: '', category: '', sort: '' };
  }
  return stored;
}

let storedSddSpecsFilters = null;
function persistStoredSddSpecsFilters({ force = false } = {}) {
  const current = {};
  SDD_SPECS_STORED_SELECT_FIELDS.forEach((field) => { current[field] = String(sddListFilters.specs[field] ?? ''); });
  if (!force && storedSddSpecsFilters && SDD_SPECS_STORED_SELECT_FIELDS.every((field) => storedSddSpecsFilters[field] === current[field])) return;
  storedSddSpecsFilters = current;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(SDD_SPECS_FILTERS_STORAGE_KEY, JSON.stringify({ version: 1, ...current }));
    }
  } catch {
    // La persistencia de los combobox no debe impedir el filtrado.
    storedSddSpecsFilters = null;
  }
}

const sddListFilters = {
  specs: { query: '', ...readStoredSddSpecsFilters() },
  database: { query: '', columns: '', sort: '' },
  ui: { query: '', kind: '', sort: '' },
  resources: { query: '', kind: '', sort: '' }
};
storedSddSpecsFilters = SDD_SPECS_STORED_SELECT_FIELDS.reduce((accumulator, field) => {
  accumulator[field] = String(sddListFilters.specs[field] ?? '');
  return accumulator;
}, {});
let renderRequestId = 0;
let specStatusRefreshId = 0;
let selectedMedia = { dataUrl: null, name: '' };
let navigateToSddView = null;
let sddActionInProgress = false;

function normaliseSpecCardColor(value) {
  const color = String(value || '').trim().toLowerCase();
  return SPEC_CARD_COLORS.some((option) => option.id === color) ? color : '';
}

function specCardColorAttribute(color) {
  const selected = normaliseSpecCardColor(color);
  return selected ? ' data-sdd-card-color="' + selected + '"' : '';
}

function specCardColorPickerMarkup(color = '') {
  const selected = normaliseSpecCardColor(color);
  const options = SPEC_CARD_COLORS.map(({ id, label }) => '<button class="sdd-card-color-option' + (selected === id ? ' is-selected' : '') + '" type="button" data-spec-card-color="' + id + '" aria-label="' + escapeHtml(label) + '" aria-pressed="' + String(selected === id) + '" title="' + escapeHtml(label) + '"><span class="sdd-card-color-swatch" aria-hidden="true"></span></button>').join('');
  return '<div class="sdd-card-color-field"><span class="sdd-card-color-label">Color de la tarjeta</span><div id="spec-card-color-picker" class="sdd-card-color-options" role="group" aria-label="Color de la tarjeta"><button class="sdd-card-color-option sdd-card-color-clear' + (selected ? '' : ' is-selected') + '" type="button" data-spec-card-color="" aria-pressed="' + String(!selected) + '">Sin color</button>' + options + '</div></div>';
}

function bindSpecCardColorPicker(initialColor = '') {
  let selectedColor = normaliseSpecCardColor(initialColor);
  const picker = $('#spec-card-color-picker');
  if (!picker) return () => selectedColor;
  const buttons = [...picker.querySelectorAll('[data-spec-card-color]')];
  const syncSelection = () => {
    buttons.forEach((button) => {
      const selected = button.dataset.specCardColor === selectedColor;
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
  };
  buttons.forEach((button) => button.addEventListener('click', () => {
    selectedColor = normaliseSpecCardColor(button.dataset.specCardColor);
    syncSelection();
  }));
  return () => selectedColor;
}

export function configureSdd({ onNavigate } = {}) {
  navigateToSddView = typeof onNavigate === 'function' ? onNavigate : null;
}

function goToSddView(view) {
  expandSddSection();
  if (navigateToSddView) {
    navigateToSddView(view);
    return;
  }
  document.querySelector(`[data-view="${view}"]`)?.click();
}

export function expandSddSection() {
  document.querySelector('.sidebar-section-sdd')?.classList.remove('is-collapsed');
  const tab = $('#sdd-home-tab');
  if (tab) tab.setAttribute('aria-expanded', 'true');
}

export function collapseSddSection() {
  document.querySelector('.sidebar-section-sdd')?.classList.add('is-collapsed');
  const tab = $('#sdd-home-tab');
  if (tab) tab.setAttribute('aria-expanded', 'false');
}

export function bindSddSectionToggle() {
  const tab = $('#sdd-home-tab');
  if (!tab || tab.dataset.sddToggleBound === 'true') return;
  tab.dataset.sddToggleBound = 'true';
  // Pulsar S.D.D. siempre expande (nunca colapsa): solo se colapsa
  // al navegar a una vista que no sea de S.D.D. (ver renderView en app.js).
  tab.addEventListener('click', () => {
    goToSddView('sdd-home');
  });
}

function storedSddProjectPath() {
  try {
    return typeof window !== 'undefined' && window.localStorage
      ? window.localStorage.getItem(SDD_PROJECT_PATH_STORAGE_KEY) || ''
      : '';
  } catch {
    return '';
  }
}

function persistSddProjectPath(projectPath) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return;
    if (projectPath) window.localStorage.setItem(SDD_PROJECT_PATH_STORAGE_KEY, projectPath);
    else window.localStorage.removeItem(SDD_PROJECT_PATH_STORAGE_KEY);
  } catch {
    // El proyecto sigue disponible durante la sesión aunque no se pueda guardar la ruta.
  }
}

export function setSddProject(project = null, { refresh = false } = {}) {
  const previousPath = state.sddProject?.path || '';
  const nextProject = project && typeof project.path === 'string' && project.path.trim()
    ? { ...project, path: project.path.trim() }
    : null;
  state.sddProject = nextProject;
  persistSddProjectPath(nextProject?.path || '');
  persistLastSddProject(nextProject);
  if (!refresh && previousPath === (nextProject?.path || '')) return;
  renderRequestId += 1;
}

export async function restoreSddProject() {
  const folder = storedSddProjectPath();
  if (!folder) return false;
  const loadProject = window.nexusData?.loadSddProject || window.nexusData?.loadSddSpecsMarkdown;
  if (typeof loadProject !== 'function') return false;
  try {
    const selection = await loadProject(folder, { prompt: false });
    if (!selection) {
      persistSddProjectPath('');
      showToast('El proyecto S.D.D guardado ya no está disponible', true);
      return false;
    }
    const result = await api('/sdd/project', { method: 'POST', body: JSON.stringify({ path: selection.path }) });
    setSddProject(result.project, { refresh: true });
    renderActiveSddViews();
    return true;
  } catch (error) {
    showToast(`No se pudo recargar el proyecto S.D.D: ${error.message}`, true);
    return false;
  }
}

function persistLastSddProject(project) {
  const payload = project && typeof project.path === 'string' && project.path.trim()
    ? { path: project.path.trim(), name: typeof project.name === 'string' ? project.name.slice(0, 120) : '' }
    : null;
  try {
    const save = window.nexusData?.saveSddLastProject;
    if (typeof save === 'function') {
      Promise.resolve(save(payload || { path: '' })).catch(() => {});
    }
  } catch {
    // El recuerdo del proyecto no debe impedir su uso en la sesión actual.
  }
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      if (payload) window.localStorage.setItem(SDD_LAST_PROJECT_STORAGE_KEY, JSON.stringify(payload));
      else window.localStorage.removeItem(SDD_LAST_PROJECT_STORAGE_KEY);
    }
  } catch {
    // Si el almacenamiento local no está disponible, se conserva el fichero del proceso principal.
  }
}

async function readLastSddProjectReference() {
  try {
    const load = window.nexusData?.loadSddLastProject;
    if (typeof load === 'function') {
      const stored = await load();
      if (stored && typeof stored.path === 'string' && stored.path.trim()) return stored;
    }
  } catch {
    // Se intenta el almacenamiento local como alternativa.
  }
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const stored = JSON.parse(window.localStorage.getItem(SDD_LAST_PROJECT_STORAGE_KEY) || 'null');
      if (stored && typeof stored.path === 'string' && stored.path.trim()) return stored;
    }
  } catch {
    return null;
  }
  return null;
}

export async function restoreLastSddProject() {
  if (hasSddProject()) return true;
  const reference = await readLastSddProjectReference();
  const savedPath = typeof reference?.path === 'string' ? reference.path.trim() : '';
  if (!savedPath) return false;
  try {
    const result = await api('/sdd/project', { method: 'POST', body: JSON.stringify({ path: savedPath }) });
    if (!result?.project?.path) return false;
    setSddProject(result.project, { refresh: true });
    renderActiveSddViews();
    return true;
  } catch {
    // La ruta guardada ya no es válida: se olvida para no reintentarla en cada arranque.
    persistLastSddProject(null);
    return false;
  }
}

function currentSddProjectPath() {
  return state.sddProject?.path || '';
}

function hasSddProject() {
  return Boolean(currentSddProjectPath());
}

function sddApi(route, options = {}) {
  const projectPath = currentSddProjectPath();
  if (!projectPath) throw new Error('Carga un proyecto S.D.D antes de continuar');
  return api(route, {
    ...options,
    cache: 'no-store',
    headers: {
      ...(options.headers || {}),
      'X-SDD-Project-Path': projectPath
    }
  });
}

function isViewActive(viewId) {
  const node = document.getElementById(viewId);
  return Boolean(node && node.classList.contains('active'));
}

function sddHeader(icon, title) {
  return `<div class="section-top"><div class="section-heading-with-icon">${sectionIconMarkup(icon)}<div class="section-heading-copy"><h1>${escapeHtml(title)}</h1></div></div></div>`;
}

function sddToolbar(label, count, addId, addLabel, extraButton = '') {
  const copy = label || count
    ? `<div class="sdd-toolbar-copy"><h2>${escapeHtml(label)}</h2><span id="${addId}-count" class="sdd-count">${escapeHtml(count)}</span></div>`
    : '';
  return `<div class="sdd-toolbar">${copy}<div class="sdd-toolbar-actions">${extraButton}<button id="${addId}" class="btn btn-primary" type="button">${escapeHtml(addLabel)}</button></div></div>`;
}

function moveSddToolbarActionsToHeader(container) {
  const header = container.querySelector('.section-top');
  const toolbar = container.querySelector('.sdd-toolbar');
  const actions = toolbar?.querySelector('.sdd-toolbar-actions');
  if (!header || !toolbar || !actions) return;
  header.append(actions);
  if (!toolbar.querySelector('.sdd-toolbar-copy')) toolbar.remove();
}

function emptyState(title, description) {
  return `<div class="empty"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(description)}</span></div>`;
}

function normaliseSddFilterText(value) {
  return String(value ?? '').toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function sddFilterMatches(values, query) {
  const term = normaliseSddFilterText(query).trim();
  if (!term) return true;
  return values.some((value) => value !== null && value !== undefined && normaliseSddFilterText(value).includes(term));
}

function sddFilterOptionsMarkup(definition, options, selectedValue = '') {
  const allOption = `<option value="">${escapeHtml(definition.allLabel)}</option>`;
  const optionMarkup = options.map((option) => {
    const selected = String(option.value) === String(selectedValue) ? ' selected' : '';
    return `<option value="${escapeHtml(option.value)}"${selected}>${escapeHtml(option.label)}</option>`;
  }).join('');
  return `${allOption}${optionMarkup}`;
}

function sddSortMarkup(filterKey) {
  const options = SDD_SORT_DEFINITIONS[filterKey] || [];
  if (!options.length) return '';
  const current = sddListFilters[filterKey]?.sort || '';
  const optionMarkup = options.map((option) => {
    const selected = String(option.value) === String(current) ? ' selected' : '';
    return `<option value="${escapeHtml(option.value)}"${selected}>${escapeHtml(option.label)}</option>`;
  }).join('');
  return `<label class="sdd-filter-select"><span>Ordenar por</span><select id="sdd-${escapeHtml(filterKey)}-sort" class="select" aria-label="Ordenar por">${optionMarkup}</select></label>`;
}

function sddFilterBar(filterKey, ariaLabel, placeholder, definitions) {
  const filter = sddListFilters[filterKey];
  const selectMarkup = definitions.map((definition) => `<label class="sdd-filter-select"><span>${escapeHtml(definition.label)}</span><select id="${escapeHtml(definition.id)}" class="select" aria-label="${escapeHtml(definition.label)}">${sddFilterOptionsMarkup(definition, definition.options, filter[definition.field])}</select></label>`).join('');
  return `<div class="sdd-filterbar" role="search" aria-label="${escapeHtml(ariaLabel)}"><label class="sdd-filter-search"><span aria-hidden="true">⌕</span><input id="sdd-${escapeHtml(filterKey)}-filter-query" class="sdd-filter-input" type="search" value="${escapeHtml(filter.query)}" placeholder="${escapeHtml(placeholder)}" autocomplete="off" aria-label="${escapeHtml(placeholder)}" /></label>${selectMarkup}${sddSortMarkup(filterKey)}<button id="sdd-${escapeHtml(filterKey)}-filter-clear" class="btn btn-secondary btn-small sdd-filter-clear" type="button" disabled>Limpiar</button></div>`;
}

function updateSddFilterClearButton(filterKey) {
  const button = $(`#sdd-${filterKey}-filter-clear`);
  if (button) button.disabled = !Object.values(sddListFilters[filterKey]).some((value) => String(value ?? '').trim().length > 0);
}

function persistSddFilterSelectors(filterKey) {
  // Solo los combobox de la vista de Specs se recuerdan entre sesiones.
  if (filterKey === 'specs') persistStoredSddSpecsFilters();
}

function bindSddFilterBar(filterKey, onChange, definitions = []) {
  const filter = sddListFilters[filterKey];
  const input = $(`#sdd-${filterKey}-filter-query`);
  const update = () => {
    updateSddFilterClearButton(filterKey);
    onChange();
  };
  if (input) {
    input.addEventListener('input', () => {
      filter.query = input.value;
      update();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !input.value) return;
      input.value = '';
      filter.query = '';
      update();
    });
  }
  definitions.forEach((definition) => {
    const select = $(`#${definition.id}`);
    if (!select) return;
    select.addEventListener('change', () => {
      filter[definition.field] = select.value;
      persistSddFilterSelectors(filterKey);
      update();
    });
  });
  const sortSelect = $(`#sdd-${filterKey}-sort`);
  if (sortSelect) {
    sortSelect.addEventListener('change', () => {
      filter.sort = sortSelect.value;
      persistSddFilterSelectors(filterKey);
      update();
    });
  }
  const clear = $(`#sdd-${filterKey}-filter-clear`);
  if (clear) clear.addEventListener('click', () => {
    Object.keys(filter).forEach((key) => { filter[key] = ''; });
    if (input) input.value = '';
    definitions.forEach((definition) => {
      const select = $(`#${definition.id}`);
      if (select) select.value = '';
    });
    const sort = $(`#sdd-${filterKey}-sort`);
    if (sort) sort.value = '';
    persistSddFilterSelectors(filterKey);
    update();
    input?.focus();
  });
  updateSddFilterClearButton(filterKey);
}

function syncSddFilterOptions(definition, options) {
  const filter = sddListFilters.specs;
  const values = options.map((option) => String(option.value));
  if (filter[definition.field] && !values.includes(String(filter[definition.field]))) {
    filter[definition.field] = '';
    // La categoría guardada dejó de existir: se olvida para no reactivarla al recargar.
    persistStoredSddSpecsFilters();
  }
  const select = $(`#${definition.id}`);
  if (!select) return;
  select.innerHTML = sddFilterOptionsMarkup(definition, options, filter[definition.field]);
  select.value = filter[definition.field] || '';
  updateSddFilterClearButton('specs');
}

function filterSddSpecs(specs) {
  const filter = sddListFilters.specs;
  return specs.filter((spec) => {
    const category = String(spec.category || '').trim();
    const statusLabel = SPEC_STATUS[spec.status] || spec.status;
    const categoryMatches = !filter.category
      || (filter.category === SDD_FILTER_NONE ? !category : normaliseSddFilterText(category) === normaliseSddFilterText(filter.category));
    return categoryMatches
      && (!filter.status || spec.status === filter.status)
      && sddFilterMatches([spec.title, category, spec.description, statusLabel], filter.query);
  });
}

function filterSddTables(tables) {
  const filter = sddListFilters.database;
  return tables.filter((table) => {
    const columns = Array.isArray(table.columns) ? table.columns : [];
    const hasColumns = columns.length > 0;
    const columnsMatches = !filter.columns
      || (filter.columns === 'with-columns' ? hasColumns : !hasColumns);
    const columnValues = columns.flatMap((column) => [column.name, column.type, column.description]);
    return columnsMatches && sddFilterMatches([table.name, table.description, ...columnValues], filter.query);
  });
}

function filterSddMedia(items) {
  const filter = sddListFilters.ui;
  return items.filter((item) => (!filter.kind || item.kind === filter.kind)
    && sddFilterMatches([item.title, item.description, item.content, MEDIA_KIND[item.kind], item.fileName], filter.query));
}

function filterSddResources(resources) {
  const filter = sddListFilters.resources;
  return resources.filter((resource) => (!filter.kind || resource.kind === filter.kind)
    && sddFilterMatches([resource.name, resource.relativePath, resource.path, MEDIA_KIND[resource.kind]], filter.query));
}

function compareSddText(left, right) {
  return String(left ?? '').localeCompare(String(right ?? ''), 'es', { sensitivity: 'base' });
}

function sddTimestamp(value) {
  const time = Date.parse(String(value ?? ''));
  return Number.isFinite(time) ? time : 0;
}

function specTimestamp(spec) {
  return sddTimestamp(spec.updatedAt || spec.createdAt);
}

function specColorOrder(spec) {
  const color = normaliseSpecCardColor(spec.color);
  if (!color) return -1;
  const index = SPEC_CARD_COLORS.findIndex((option) => option.id === color);
  return index < 0 ? Number.MAX_SAFE_INTEGER : index;
}

function sortSddSpecs(list) {
  const sort = sddListFilters.specs.sort || '';
  if (!sort) return list;
  const sorted = [...list];
  switch (sort) {
    case 'title-asc':
      sorted.sort((left, right) => compareSddText(left.title, right.title));
      break;
    case 'updated-desc':
      sorted.sort((left, right) => specTimestamp(right) - specTimestamp(left) || compareSddText(left.title, right.title));
      break;
    case 'color-asc':
      sorted.sort((left, right) => specColorOrder(left) - specColorOrder(right) || compareSddText(left.title, right.title));
      break;
    default:
      break;
  }
  return sorted;
}

function tableTimestamp(table) {
  return sddTimestamp(table.updatedAt || table.createdAt);
}

function tableColumnCount(table) {
  return Array.isArray(table.columns) ? table.columns.length : 0;
}

function sortSddTables(list) {
  const sort = sddListFilters.database.sort || '';
  if (!sort) return list;
  const sorted = [...list];
  switch (sort) {
    case 'name-asc':
      sorted.sort((left, right) => compareSddText(left.name, right.name));
      break;
    case 'columns-desc':
      sorted.sort((left, right) => tableColumnCount(right) - tableColumnCount(left) || compareSddText(left.name, right.name));
      break;
    case 'updated-desc':
      sorted.sort((left, right) => tableTimestamp(right) - tableTimestamp(left) || compareSddText(left.name, right.name));
      break;
    default:
      break;
  }
  return sorted;
}

function mediaTimestamp(item) {
  return sddTimestamp(item.updatedAt || item.createdAt);
}

function sortSddMedia(list) {
  const sort = sddListFilters.ui.sort || '';
  if (!sort) return list;
  const sorted = [...list];
  switch (sort) {
    case 'title-asc':
      sorted.sort((left, right) => compareSddText(left.title, right.title));
      break;
    case 'updated-desc':
      sorted.sort((left, right) => mediaTimestamp(right) - mediaTimestamp(left) || compareSddText(left.title, right.title));
      break;
    default:
      break;
  }
  return sorted;
}

function sortSddResources(list) {
  const sort = sddListFilters.resources.sort || '';
  if (!sort) return list;
  const sorted = [...list];
  switch (sort) {
    case 'name-asc':
      sorted.sort((left, right) => compareSddText(left.name, right.name) || compareSddText(left.relativePath, right.relativePath));
      break;
    case 'size-desc':
      sorted.sort((left, right) => (Number(right.size) || 0) - (Number(left.size) || 0) || compareSddText(left.name, right.name));
      break;
    case 'modified-desc':
      sorted.sort((left, right) => sddTimestamp(right.modifiedAt) - sddTimestamp(left.modifiedAt) || compareSddText(left.name, right.name));
      break;
    default:
      break;
  }
  return sorted;
}

function sddCollectionCount(visible, total, singular, plural) {
  const visibleLabel = `${visible} ${visible === 1 ? singular : plural}`;
  if (visible === total) return visibleLabel;
  return `${visibleLabel} de ${total} ${total === 1 ? singular : plural}`;
}

function previewText(value, limit = 120) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
}

function dataUrlToBytes(dataUrl) {
  const match = /^data:([^;,]+);base64,(.*)$/.exec(String(dataUrl || ''));
  if (!match) throw new Error('El archivo no se pudo leer');
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

async function confirmDelete(message) {
  return window.confirm(message);
}

/* ------------------------------------------------------------ Crear specs */

function renderSddProjectRequired(container, icon, title) {
  if (hasSddProject()) return false;
  container.innerHTML = `${sddHeader(icon, title)}${emptyState('Sin proyecto S.D.D', `Usa el menú superior “Proyecto” > “Cargar Proyecto” para seleccionar un proyecto que contenga la carpeta ${SPECS_FOLDER_NAME} (con ${SPECS_FILE_NAME}, ${SPECS_FULL_FILE_NAME} y ${SPECS_RESOURCES_FOLDER_NAME}).`)}`;
  return true;
}

function renderActiveSddViews() {
  if (isViewActive('view-sdd-home')) renderSddHome();
  if (isViewActive('view-sdd-specs')) renderSddSpecs();
  if (isViewActive('view-sdd-database')) renderSddDatabase();
  if (isViewActive('view-sdd-ui')) renderSddUi();
  if (isViewActive('view-sdd-resources')) renderSddResources();
}

function escapeCssIdentifier(value) {
  const text = String(value ?? '');
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(text);
  return text.replace(/["\\]/g, '\\$&');
}

function focusSpecStatusButton(specId, root = document) {
  if (!specId || !root || typeof root.querySelector !== 'function') return;
  const selector = `[data-implement-spec="${escapeCssIdentifier(specId)}"], [data-activate-spec="${escapeCssIdentifier(specId)}"]`;
  const target = root.querySelector(selector);
  if (target && typeof target.focus === 'function') target.focus({ preventScroll: true });
}

function updateSddHomeSpecsSection(specs) {
  const view = document.getElementById('view-sdd-home');
  const listNode = document.getElementById('sdd-home-specs-list');
  if (!view || !listNode) return false;
  const scrollTop = view.scrollTop;
  const list = Array.isArray(specs) ? specs : [];
  const pending = list.filter((spec) => spec.status !== 'implemented').length;
  const count = document.getElementById('sdd-home-specs-count');
  if (count) count.textContent = `${pending} pendientes`;
  const summary = document.getElementById('sdd-home-summary-specs');
  if (summary) summary.textContent = `${list.length}`;
  listNode.innerHTML = list.length ? list.map(sddHomeSpecSummary).join('') : emptyState('Sin requisitos', 'Añade el primero con “＋ Añadir spec”.');
  listNode.querySelectorAll('[data-sdd-goto-card]').forEach((card) => card.addEventListener('click', () => goToSddView(card.dataset.sddGotoCard)));
  bindQuickImplementationActions(listNode, list);
  view.scrollTop = scrollTop;
  return true;
}

async function refreshSpecsAfterStatusChange(specId) {
  const refreshId = ++specStatusRefreshId;
  const specsViewActive = isViewActive('view-sdd-specs');
  const homeViewActive = isViewActive('view-sdd-home');
  // Si la estructura ya no existe (p. ej. navegación intermedia), recurrir al render completo.
  if (specsViewActive && !document.getElementById('sdd-spec-list')) {
    renderSddSpecs();
    return;
  }
  if (homeViewActive && !document.getElementById('sdd-home-specs-list')) {
    renderSddHome();
    return;
  }
  if (!specsViewActive && !homeViewActive) {
    renderActiveSddViews();
    return;
  }
  try {
    const { specs } = await sddApi('/sdd/specs');
    if (refreshId !== specStatusRefreshId) return;
    const list = Array.isArray(specs) ? specs : [];
    if (specsViewActive && isViewActive('view-sdd-specs')) {
      // renderSpecList conserva el scroll y el foco de la lista existente:
      // no se reconstruye la vista para no volver al inicio.
      renderSpecList(list);
      focusSpecStatusButton(specId, document.getElementById('sdd-spec-list'));
    }
    if (homeViewActive && isViewActive('view-sdd-home')) {
      updateSddHomeSpecsSection(list);
      focusSpecStatusButton(specId, document.getElementById('sdd-home-specs-list'));
    }
  } catch (error) {
    if (refreshId !== specStatusRefreshId) return;
    showToast(error.message, true);
    // La lista no se ha reconstruido: re-habilitar para permitir reintentar.
    document.querySelectorAll('#sdd-spec-list [disabled], #sdd-home-specs-list [disabled]').forEach((node) => { node.disabled = false; });
  }
}

async function setSpecStatus(spec, nextStatus, button = null) {
  if (!spec || (nextStatus !== 'active' && nextStatus !== 'implemented')) return;
  if (spec.status === nextStatus) return;
  if (button) button.disabled = true;
  try {
    await sddApi('/sdd/specs/bulk', {
      method: 'PATCH',
      body: JSON.stringify({ ids: [spec.id], changes: { status: nextStatus } })
    });
    showToast(nextStatus === 'active' ? 'Spec reactivada' : 'Spec marcada como implementada');
    // Refresco ligero que conserva la posición de scroll en lugar de
    // reconstruir toda la vista (que devolvía la lista al inicio).
    await refreshSpecsAfterStatusChange(spec.id);
  } catch (error) {
    if (button && document.contains(button)) button.disabled = false;
    showToast(error.message, true);
  }
}

function bindQuickImplementationActions(root, specs) {
  if (!root) return;
  root.querySelectorAll('[data-implement-spec]').forEach((button) => button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const spec = specs.find((item) => item.id === button.dataset.implementSpec);
    if (spec) void setSpecStatus(spec, 'implemented', button);
  }));
  root.querySelectorAll('[data-activate-spec]').forEach((button) => button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const spec = specs.find((item) => item.id === button.dataset.activateSpec);
    if (spec) void setSpecStatus(spec, 'active', button);
  }));
}

/* --------------------------------------------------------------- Vista S.D.D */

function sddHomeSection(id, title, view) {
  return `<section class="sdd-home-section" aria-label="${escapeHtml(title)}"><div class="sdd-toolbar"><div class="sdd-toolbar-copy"><h2>${escapeHtml(title)}</h2><span id="sdd-home-${id}-count" class="sdd-count">…</span></div><div class="sdd-toolbar-actions"><button class="btn btn-secondary btn-small" type="button" data-sdd-goto="${view}">Abrir</button></div></div><div class="sdd-list" id="sdd-home-${id}-list"><div class="empty">Cargando…</div></div></section>`;
}

function sddHomeSummaryStrip() {
  const stat = (id, label) => `<div class="sdd-summary-stat"><span class="sdd-summary-value" id="sdd-home-summary-${id}">…</span><span class="sdd-summary-label">${escapeHtml(label)}</span></div>`;
  return `<div class="sdd-summary-strip" id="sdd-home-summary">${stat('specs', 'Specs')}${stat('database', 'Base de datos')}${stat('ui', 'UI')}${stat('resources', 'Recursos')}</div>`;
}

function sddHomeSpecSummary(spec) {
  return `<article class="sdd-card"${specCardColorAttribute(spec.color)} data-sdd-goto-card="sdd-specs"><div class="sdd-card-head"><div class="sdd-card-main"><h3 class="sdd-card-title">${escapeHtml(spec.title)}</h3><div class="sdd-badges">${specBadges(spec, { quickImplementation: true })}</div></div></div>${spec.description ? `<p class="sdd-card-desc">${escapeHtml(previewText(spec.description))}</p>` : ''}</article>`;
}

function sddHomeTableSummary(table) {
  const columns = Array.isArray(table.columns) ? table.columns : [];
  const columnNames = columns.slice(0, 6).map((column) => escapeHtml(column.name)).join(', ');
  return `<article class="sdd-card" data-sdd-goto-card="sdd-database"><div class="sdd-card-head"><div class="sdd-card-main"><h3 class="sdd-card-title sdd-table-name">${escapeHtml(table.name)}</h3><div class="sdd-badges"><span class="sdd-badge sdd-badge-table">${columns.length} ${columns.length === 1 ? 'columna' : 'columnas'}</span></div></div></div>${table.description ? `<p class="sdd-card-desc">${escapeHtml(previewText(table.description))}</p>` : ''}${columnNames ? `<div class="sdd-card-meta sdd-summary-columns">${columnNames}${columns.length > 6 ? '…' : ''}</div>` : ''}</article>`;
}

function sddHomeMediaSummary(item) {
  const snippet = item.kind === 'text' && item.content ? `<p class="sdd-card-desc">${escapeHtml(previewText(item.content))}</p>` : (item.description ? `<p class="sdd-card-desc">${escapeHtml(previewText(item.description))}</p>` : '');
  return `<article class="sdd-card" data-sdd-goto-card="sdd-ui"><div class="sdd-card-main"><h3 class="sdd-card-title">${escapeHtml(item.title)}</h3><div class="sdd-media-meta">${mediaBadge(item.kind)}<span>${escapeHtml(shortDate(item.updatedAt))}</span></div></div>${snippet}</article>`;
}

function sddHomeResourceSummary(resource) {
  return `<article class="sdd-card" data-sdd-goto-card="sdd-resources"><div class="sdd-card-main"><h3 class="sdd-card-title">${escapeHtml(resource.name)}</h3><div class="sdd-media-meta">${mediaBadge(resource.kind)}<span>${escapeHtml(formatBytes(resource.size))}</span></div></div></article>`;
}

export function renderSddHome() {
  const container = $('#view-sdd-home');
  if (!container) return;
  if (!hasSddProject()) {
    container.innerHTML = sddHeader('sdd', 'S.D.D');
    return;
  }
  // Con proyecto y especificaciones cargadas: resumen de todos los
  // requerimientos de las 4 vistas (Specs, Base de datos, UI y Recursos).
  const projectName = state.sddProject?.name || state.sddProject?.path || 'Resumen del proyecto';
  const requestId = ++renderRequestId;
  container.innerHTML = `${sddHeader('sdd', projectName)}`
    + sddHomeSummaryStrip()
    + `<div class="sdd-toolbar"><div class="sdd-toolbar-copy"><h2>Secciones</h2></div><div class="sdd-toolbar-actions">`
    + `<button id="sdd-home-reload" class="btn btn-secondary btn-small" type="button">Recargar</button>`
    + `</div></div>`
    + sddHomeSection('specs', 'Specs', 'sdd-specs')
    + sddHomeSection('database', 'Base de datos', 'sdd-database')
    + sddHomeSection('ui', 'UI', 'sdd-ui')
    + sddHomeSection('resources', 'Recursos', 'sdd-resources');
  const bindGoto = (root) => {
    root.querySelectorAll('[data-sdd-goto]').forEach((button) => button.addEventListener('click', () => goToSddView(button.dataset.sddGoto)));
    root.querySelectorAll('[data-sdd-goto-card]').forEach((card) => card.addEventListener('click', () => goToSddView(card.dataset.sddGotoCard)));
  };
  bindGoto(container);
  $('#sdd-home-reload')?.addEventListener('click', () => $('#sdd-reload')?.click());

  const setCount = (id, text) => {
    const target = document.getElementById(`sdd-home-${id}-count`);
    if (target) target.textContent = text;
  };
  const setSummary = (id, text) => {
    const target = document.getElementById(`sdd-home-summary-${id}`);
    if (target) target.textContent = text;
  };
  const setList = (id, html) => {
    const target = document.getElementById(`sdd-home-${id}-list`);
    if (target) {
      target.innerHTML = html;
      bindGoto(target);
    }
  };

  sddApi('/sdd/specs').then(({ specs }) => {
    if (requestId !== renderRequestId || !isViewActive('view-sdd-home')) return;
    const list = Array.isArray(specs) ? specs : [];
    const pending = list.filter((spec) => spec.status !== 'implemented').length;
    setCount('specs', `${pending} pendientes`);
    setSummary('specs', `${list.length}`);
    setList('specs', list.length ? list.map(sddHomeSpecSummary).join('') : emptyState('Sin requisitos', 'Añade el primero con “＋ Añadir spec”.'));
    bindQuickImplementationActions(document.getElementById('sdd-home-specs-list'), list);
  }).catch((error) => {
    if (requestId !== renderRequestId || !isViewActive('view-sdd-home')) return;
    setCount('specs', '—');
    setSummary('specs', '—');
    setList('specs', emptyState('No se pudo cargar', error.message));
  });

  sddApi('/sdd/db').then(({ tables }) => {
    if (requestId !== renderRequestId || !isViewActive('view-sdd-home')) return;
    const list = Array.isArray(tables) ? tables : [];
    const columns = list.reduce((total, table) => total + (Array.isArray(table.columns) ? table.columns.length : 0), 0);
    setCount('database', `${columns} ${columns === 1 ? 'columna' : 'columnas'}`);
    setSummary('database', `${list.length}`);
    setList('database', list.length ? list.map(sddHomeTableSummary).join('') : emptyState('Sin tablas', 'Añade la primera con “＋ Añadir tabla”.'));
  }).catch((error) => {
    if (requestId !== renderRequestId || !isViewActive('view-sdd-home')) return;
    setCount('database', '—');
    setSummary('database', '—');
    setList('database', emptyState('No se pudo cargar', error.message));
  });

  sddApi('/sdd/media').then(({ media }) => {
    if (requestId !== renderRequestId || !isViewActive('view-sdd-home')) return;
    const list = Array.isArray(media) ? media : [];
    setCount('ui', '');
    setSummary('ui', `${list.length}`);
    setList('ui', list.length ? list.map(sddHomeMediaSummary).join('') : emptyState('Sin contenido', 'Añade con “＋ Añadir contenido”.'));
  }).catch((error) => {
    if (requestId !== renderRequestId || !isViewActive('view-sdd-home')) return;
    setCount('ui', '—');
    setSummary('ui', '—');
    setList('ui', emptyState('No se pudo cargar', error.message));
  });

  readSpecsResources().then((data) => {
    if (requestId !== renderRequestId || !isViewActive('view-sdd-home')) return;
    const list = Array.isArray(data?.resources) ? data.resources : [];
    const totalBytes = list.reduce((total, resource) => total + (Number(resource.size) || 0), 0);
    setCount('resources', formatBytes(totalBytes));
    setSummary('resources', `${list.length}`);
    setList('resources', list.length ? list.map(sddHomeResourceSummary).join('') : emptyState('Sin recursos', `Coloca archivos en “${SPECS_FOLDER_NAME}/${SPECS_RESOURCES_FOLDER_NAME}”.`));
  }).catch((error) => {
    if (requestId !== renderRequestId || !isViewActive('view-sdd-home')) return;
    setCount('resources', '—');
    setSummary('resources', '—');
    setList('resources', emptyState('No se pudieron cargar', error.message));
  });
}

async function createSddProjectFromMenu() {
  const createProject = window.nexusData?.createSddProject;
  if (typeof createProject !== 'function') {
    showToast('La creación de proyectos no está disponible en esta ventana', true);
    return;
  }
  try {
    const selection = await createProject();
    if (!selection) return;
    const result = await api('/sdd/project', { method: 'POST', body: JSON.stringify({ path: selection.path || selection.sddPath }) });
    setSddProject(result.project, { refresh: true });
    showToast(`${result.total} ${result.total === 1 ? 'requisito' : 'requisitos'} cargados desde ${SPECS_FULL_FILE_NAME}`);
    renderActiveSddViews();
  } catch (error) {
    showToast(error.message, true);
  }
}

export function bindProjectMenu() {
  window.nexusData?.onProjectMenuAction?.((action) => {
    if (action === 'new-project') void createSddProjectFromMenu();
    if (action === 'load-project') void loadSddProjectFromMenu();
  });
}

export function bindSddPromptOption() {
  const checkbox = $('#sdd-include-full-prompt');
  if (checkbox) {
    try {
      // Al arrancar, el checkbox del DOM aún tiene su valor por defecto (sin marcar):
      // hay que inicializarlo desde lo almacenado, no desde el propio checkbox.
      checkbox.checked = readStoredSddPromptIncludeFull();
    } catch {
      checkbox.checked = false;
    }
    checkbox.addEventListener('change', () => {
      persistSddPromptIncludeFull(checkbox.checked);
      showToast(checkbox.checked
        ? 'El Agente tendrá en cuenta todas las especificaciones'
        : 'El Agente solo tendrá en cuenta las especificaciones no implementadas',
      false,
      { replaceKey: 'sdd-prompt-option' });
    });
  }

  const skipTestsCheckbox = $('#sdd-skip-tests-prompt');
  if (!skipTestsCheckbox) return;
  try {
    skipTestsCheckbox.checked = readStoredSddPromptSkipTests();
  } catch {
    skipTestsCheckbox.checked = false;
  }
  skipTestsCheckbox.addEventListener('change', () => {
    persistSddPromptSkipTests(skipTestsCheckbox.checked);
    showToast(skipTestsCheckbox.checked
      ? 'El Agente no realizará tests sobre los cambios aplicados'
      : 'El Agente podrá realizar tests sobre los cambios aplicados',
    false,
    { replaceKey: 'sdd-skip-tests-prompt-option' });
  });
}

/* -------------------------------------------------------------------- Cargar */

async function openSpecsMarkdownEditor() {
  if (!hasSddProject()) return;
  try {
    const { path, markdown } = await sddApi('/sdd/specs/markdown');
    $('#modal-root').innerHTML = `<div class="modal-backdrop"><div class="modal sdd-md-modal" role="dialog" aria-modal="true" aria-labelledby="sdd-md-modal-title"><div class="modal-head"><div><h2 id="sdd-md-modal-title">Editar ${SPECS_FULL_FILE_NAME} del proyecto</h2><p>${escapeHtml(path)}</p></div><button class="modal-close" data-close-modal aria-label="Cerrar">×</button></div><div class="modal-body"><textarea id="sdd-md-content" class="textarea sdd-md-textarea" spellcheck="false">${escapeHtml(markdown)}</textarea></div><div class="modal-actions"><button class="btn btn-secondary" data-close-modal type="button">Cancelar</button><button id="sdd-md-apply" class="btn btn-primary" type="button">Aplicar al proyecto</button></div></div></div>`;
    bindModalClose();
    $('#sdd-md-apply').addEventListener('click', async () => {
      const content = $('#sdd-md-content');
      const button = $('#sdd-md-apply');
      button.disabled = true;
      try {
        const result = await sddApi('/sdd/specs/sync', { method: 'POST', body: JSON.stringify({ markdown: content.value }) });
        closeModal();
        const pending = Number(result.pendingTotal ?? result.total ?? 0);
        const total = Number(result.total ?? 0);
        showToast(`${total} ${total === 1 ? 'requisito' : 'requisitos'} en ${SPECS_FULL_FILE_NAME} (${pending} ${pending === 1 ? 'pendiente' : 'pendientes'} en ${SPECS_FILE_NAME})`);
        if (isViewActive('view-sdd-specs')) renderSddSpecs();
      } catch (error) {
        showToast(error.message, true);
        button.disabled = false;
      }
    });
  } catch (error) {
    showToast(error.message, true);
  }
}

async function loadSddProjectFromMenu() {
  if (sddActionInProgress) return;
  const loadProject = window.nexusData?.loadSddProject;
  if (typeof loadProject !== 'function') {
    showToast('El selector de carpetas no está disponible en esta ventana', true);
    return;
  }
  sddActionInProgress = true;
  try {
    const selection = await loadProject();
    if (!selection) return;
    const result = await api('/sdd/project', { method: 'POST', body: JSON.stringify({ path: selection.path || selection.sddPath }) });
    setSddProject(result.project, { refresh: true });
    showToast(`${result.total} ${result.total === 1 ? 'requisito' : 'requisitos'} cargados desde ${SPECS_FULL_FILE_NAME}`);
    renderActiveSddViews();
  } catch (error) {
    showToast(error.message, true);
  } finally {
    sddActionInProgress = false;
  }
}

async function createSddSpecsFromMenu() {
  if (sddActionInProgress) return;
  const selectSpecsPath = window.nexusData?.selectSddSpecsPath;
  if (typeof selectSpecsPath !== 'function') {
    showToast('El selector de carpetas no está disponible en esta ventana', true);
    return;
  }
  sddActionInProgress = true;
  try {
    const selection = await selectSpecsPath(currentSddProjectPath());
    if (!selection) return;
    showToast(selection.created
      ? `${SPECS_FOLDER_NAME} creado con ${SPECS_FILE_NAME}, ${SPECS_FULL_FILE_NAME} y ${SPECS_RESOURCES_FOLDER_NAME}`
      : `${SPECS_FOLDER_NAME} ya existía; no se ha modificado nada`);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    sddActionInProgress = false;
  }
}

export function bindSddMenu() {
  window.nexusData?.onSddMenuAction?.((action) => {
    if (action === 'create') void createSddSpecsFromMenu();
  });
}

export function bindSddReload() {
  const button = $('#sdd-reload');
  if (!button) return;
  button.addEventListener('click', async () => {
    const loadProject = window.nexusData?.loadSddProject;
    if (typeof loadProject !== 'function') {
      showToast('La recarga no está disponible en esta ventana', true);
      return;
    }
    const folder = currentSddProjectPath();
    if (!folder) {
      showToast('No hay ningún proyecto S.D.D cargado para recargar', true);
      return;
    }
    button.disabled = true;
    button.textContent = '…';
    try {
      const selection = await loadProject(folder);
      if (!selection) return;
      const result = await api('/sdd/project', { method: 'POST', body: JSON.stringify({ path: selection.path }) });
      setSddProject(result.project, { refresh: true });
      showToast('Proyecto S.D.D recargado desde disco');
      renderActiveSddViews();
    } catch (error) {
      showToast(error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = '⟳';
    }
  });
}

/* ------------------------------------------------------------------ Specs */

function specBadges(spec, { quickImplementation = false } = {}) {
  const category = spec.category ? `<span class="sdd-badge sdd-badge-category">${escapeHtml(spec.category)}</span>` : '';
  const status = spec.status === 'implemented' ? 'implemented' : 'active';
  const label = SPEC_STATUS[status];
  if (!quickImplementation) return `${category}<span class="sdd-badge sdd-status-${status}">${label}</span>`;
  if (status === 'active') {
    return `${category}<button class="sdd-badge sdd-status-active sdd-status-action" type="button" data-implement-spec="${escapeHtml(spec.id)}" title="Marcar como implementada" aria-label="Marcar como implementada">${label}</button>`;
  }
  return `${category}<button class="sdd-badge sdd-status-implemented sdd-status-action" type="button" data-activate-spec="${escapeHtml(spec.id)}" title="Volver a activar" aria-label="Volver a activar">${label}</button>`;
}

function specCard(spec) {
  return `<article class="sdd-card"${specCardColorAttribute(spec.color)} data-spec-id="${escapeHtml(spec.id)}">
    <div class="sdd-card-head">
      <div class="sdd-card-main">
        <h3 class="sdd-card-title">${escapeHtml(spec.title)}</h3>
        <div class="sdd-badges">${specBadges(spec, { quickImplementation: true })}</div>
      </div>
      <div class="sdd-card-actions">
        <button class="btn btn-secondary btn-small" type="button" data-edit-spec="${escapeHtml(spec.id)}">Editar</button>
        <button class="btn btn-danger btn-small" type="button" data-delete-spec="${escapeHtml(spec.id)}">Eliminar</button>
      </div>
    </div>
    ${spec.description ? `<p class="sdd-card-desc">${escapeHtml(spec.description)}</p>` : ''}
    <div class="sdd-card-meta">Actualizada ${escapeHtml(shortDate(spec.updatedAt))}</div>
  </article>`;
}

function renderSpecList(specs) {
  const allSpecs = Array.isArray(specs) ? specs : [];
  const categoryDefinition = SDD_FILTER_DEFINITIONS.specs.find((definition) => definition.field === 'category');
  const usedCategories = [...new Set(allSpecs.map((spec) => String(spec.category || '').trim()).filter(Boolean))];
  const isDefaultCategory = (category) => SPEC_CATEGORIES.some((def) => normaliseSddFilterText(def) === normaliseSddFilterText(category));
  const customCategories = usedCategories
    .filter((category) => !isDefaultCategory(category))
    .sort((left, right) => normaliseSddFilterText(left).localeCompare(normaliseSddFilterText(right), 'es'))
    .map((category) => ({ value: category, label: category }));
  const categories = [...SPEC_CATEGORIES.map((category) => ({ value: category, label: category })), ...customCategories];
  if (allSpecs.some((spec) => !String(spec.category || '').trim())) categories.push({ value: SDD_FILTER_NONE, label: 'Sin categoría' });
  syncSddFilterOptions(categoryDefinition, categories);
  const visibleSpecs = sortSddSpecs(filterSddSpecs(allSpecs));
  const list = $('#sdd-spec-list');
  if (!list) return;
  // Conservar scroll y foco: esta lista se re-renderiza al filtrar, ordenar
  // y al cambiar el estado Activa/Implementada. Sin esto, cada cambio
  // devolvía la vista al inicio y obligaba a volver a scrollear.
  const previousScrollTop = list.scrollTop;
  const active = document.activeElement;
  const activeInList = active && typeof active.hasAttribute === 'function' && list.contains(active);
  const focusedSpecId = activeInList
    ? (active.dataset.implementSpec || active.dataset.activateSpec || active.dataset.editSpec || active.dataset.deleteSpec || null)
    : null;
  const focusedWasStatus = Boolean(activeInList && (active.hasAttribute('data-implement-spec') || active.hasAttribute('data-activate-spec')));
  list.innerHTML = visibleSpecs.length
    ? visibleSpecs.map(specCard).join('')
    : allSpecs.length
      ? emptyState('Sin resultados', 'Prueba con otros filtros.')
      : emptyState('Sin requisitos', 'Usa “＋ Añadir spec”.');
  list.scrollTop = previousScrollTop;
  bindQuickImplementationActions(list, allSpecs);
  list.querySelectorAll('[data-edit-spec]').forEach((button) => button.addEventListener('click', () => {
    const spec = allSpecs.find((item) => item.id === button.dataset.editSpec);
    if (spec) openSpecModal(spec);
  }));
  list.querySelectorAll('[data-delete-spec]').forEach((button) => button.addEventListener('click', async () => {
    const spec = allSpecs.find((item) => item.id === button.dataset.deleteSpec);
    if (!spec) return;
    if (!await confirmDelete(`¿Eliminar la spec “${spec.title}”?`)) return;
    try {
      await sddApi(`/sdd/specs/${spec.id}`, { method: 'DELETE' });
      showToast('Spec eliminada');
      renderSddSpecs();
    } catch (error) { showToast(error.message, true); }
  }));
  if (focusedSpecId) {
    const selector = focusedWasStatus
      ? `[data-implement-spec="${escapeCssIdentifier(focusedSpecId)}"], [data-activate-spec="${escapeCssIdentifier(focusedSpecId)}"]`
      : `[data-edit-spec="${escapeCssIdentifier(focusedSpecId)}"], [data-delete-spec="${escapeCssIdentifier(focusedSpecId)}"]`;
    const target = list.querySelector(selector);
    if (target && typeof target.focus === 'function') target.focus({ preventScroll: true });
  }
}

function openSpecModal(existing = null) {
  const statusOptions = Object.entries(SPEC_STATUS).map(([value, label]) => `<option value="${value}"${existing?.status === value ? ' selected' : ''}>${label}</option>`).join('');
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="sdd-spec-modal-title"><div class="modal-head"><div><h2 id="sdd-spec-modal-title">${existing ? 'Editar spec' : 'Añadir spec'}</h2></div><button class="modal-close" data-close-modal aria-label="Cerrar">×</button></div><div class="modal-body"><div class="form-grid"><label class="form-label">Título<input id="spec-title" class="field" type="text" value="${escapeHtml(existing?.title || '')}" maxlength="200" autocomplete="off" autofocus /></label><label class="form-label">Estado<select id="spec-status" class="select">${statusOptions}</select></label><label class="form-label">Categoría<input id="spec-category" class="field" type="text" list="spec-category-options" value="${escapeHtml(existing?.category || '')}" maxlength="60" autocomplete="off" placeholder="Ej. Funcional" /></label><datalist id="spec-category-options">${SPEC_CATEGORIES.map((category) => `<option value="${escapeHtml(category)}"></option>`).join('')}</datalist><label class="form-label">Descripción<textarea id="spec-description" class="textarea" maxlength="10000">${escapeHtml(existing?.description || '')}</textarea></label></div></div><div class="modal-actions"><button class="btn btn-secondary" data-close-modal type="button">Cancelar</button><button id="spec-save" class="btn btn-primary" type="button">${existing ? 'Guardar cambios' : 'Añadir spec'}</button></div></div></div>`;
  bindModalClose();
  $('#spec-category')?.closest('.form-label')?.insertAdjacentHTML('afterend', specCardColorPickerMarkup(existing?.color));
  const readCardColor = bindSpecCardColorPicker(existing?.color);
  $('#spec-save').addEventListener('click', async () => {
    try {
      const body = {
        title: $('#spec-title').value.trim(),
        status: $('#spec-status').value,
        category: $('#spec-category').value.trim(),
        description: $('#spec-description').value,
        color: readCardColor()
      };
      await sddApi(existing ? `/sdd/specs/${existing.id}` : '/sdd/specs', { method: existing ? 'PUT' : 'POST', body: JSON.stringify(body) });
      closeModal();
      showToast(existing ? 'Spec actualizada' : 'Spec creada');
      renderSddSpecs();
    } catch (error) { showToast(error.message, true); }
  });
}

export function renderSddSpecs() {
  const container = $('#view-sdd-specs');
  if (!container) return;
  if (renderSddProjectRequired(container, 'specs', 'Specs')) return;
  const requestId = ++renderRequestId;
  const filterDefinitions = SDD_FILTER_DEFINITIONS.specs;
  container.innerHTML = `${sddHeader('specs', 'Specs')}${sddToolbar('', '', 'sdd-spec-add', '＋ Añadir spec', `<button id="sdd-md-edit" class="btn btn-secondary" type="button" title="Volver a leer y editar ${SPECS_FULL_FILE_NAME} del proyecto">Editar markdown</button>`)}${sddFilterBar('specs', 'Filtros de requisitos', 'Buscar por título, categoría o descripción…', filterDefinitions)}<div class="sdd-list" id="sdd-spec-list"><div class="empty">Cargando especificaciones…</div></div>`;
  moveSddToolbarActionsToHeader(container);
  $('#sdd-spec-add').addEventListener('click', () => openSpecModal());
  const mdEdit = $('#sdd-md-edit');
  if (mdEdit) mdEdit.addEventListener('click', openSpecsMarkdownEditor);
  let specs = null;
  const render = () => {
    if (specs !== null) renderSpecList(specs);
  };
  bindSddFilterBar('specs', render, filterDefinitions);
  sddApi('/sdd/specs').then(({ specs: loadedSpecs }) => {
    if (requestId !== renderRequestId || !isViewActive('view-sdd-specs')) return;
    specs = Array.isArray(loadedSpecs) ? loadedSpecs : [];
    render();
  }).catch((error) => {
    if (requestId !== renderRequestId || !isViewActive('view-sdd-specs')) return;
    $('#sdd-spec-list').innerHTML = emptyState('No se pudo cargar', error.message);
  });
}

/* ----------------------------------------------------------- Base de datos */

function columnConstraints(column) {
  const badges = [];
  if (column.primaryKey) badges.push('<span class="sdd-badge sdd-badge-pk">PK</span>');
  badges.push(column.nullable ? '<span class="sdd-badge">NULL</span>' : '<span class="sdd-badge sdd-badge-notnull">NOT NULL</span>');
  if (column.defaultValue) badges.push(`<span class="sdd-badge sdd-badge-default">def: ${escapeHtml(column.defaultValue)}</span>`);
  return badges.join('');
}

function tableCard(table) {
  const columnsRows = table.columns.map((column) => `<tr>
    <td class="sdd-column-name">${escapeHtml(column.name)}</td>
    <td class="sdd-column-type">${escapeHtml(column.type)}</td>
    <td class="sdd-column-constraints">${columnConstraints(column)}</td>
    <td class="sdd-column-description">${escapeHtml(column.description)}</td>
    <td class="sdd-column-actions">
      <button class="sdd-column-action" type="button" data-edit-column="${escapeHtml(column.id)}" title="Editar columna" aria-label="Editar columna">✎</button>
      <button class="sdd-column-action sdd-column-action-danger" type="button" data-delete-column="${escapeHtml(column.id)}" title="Eliminar columna" aria-label="Eliminar columna">×</button>
    </td>
  </tr>`).join('');
  const body = columnsRows || `<tr><td colspan="5" class="sdd-column-empty">Sin columnas. Usa “＋ Columna”.</td></tr>`;
  return `<article class="sdd-card sdd-table-card" data-table-id="${escapeHtml(table.id)}">
    <div class="sdd-card-head">
      <div class="sdd-card-main">
        <h3 class="sdd-card-title sdd-table-name">${escapeHtml(table.name)}</h3>
        <div class="sdd-badges"><span class="sdd-badge sdd-badge-table">${table.columns.length} ${table.columns.length === 1 ? 'columna' : 'columnas'}</span></div>
      </div>
      <div class="sdd-card-actions">
        <button class="btn btn-secondary btn-small" type="button" data-add-column="${escapeHtml(table.id)}">＋ Columna</button>
        <button class="btn btn-secondary btn-small" type="button" data-edit-table="${escapeHtml(table.id)}">Editar</button>
        <button class="btn btn-danger btn-small" type="button" data-delete-table="${escapeHtml(table.id)}">Eliminar</button>
      </div>
    </div>
    ${table.description ? `<p class="sdd-card-desc">${escapeHtml(table.description)}</p>` : ''}
    <table class="sdd-table-columns">
      <thead><tr><th>Columna</th><th>Tipo</th><th>Restricciones</th><th>Descripción</th><th></th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </article>`;
}

function renderTableList(tables) {
  const allTables = Array.isArray(tables) ? tables : [];
  const visibleTables = sortSddTables(filterSddTables(allTables));
  const count = $('#sdd-db-add-count');
  if (count) count.textContent = sddCollectionCount(visibleTables.length, allTables.length, 'tabla', 'tablas');
  const list = $('#sdd-db-list');
  if (!list) return;
  list.innerHTML = visibleTables.length
    ? visibleTables.map(tableCard).join('')
    : allTables.length
      ? emptyState('Sin resultados', 'Prueba con otros filtros.')
      : emptyState('Sin tablas', 'Usa “＋ Añadir tabla”.');
  list.querySelectorAll('[data-add-column]').forEach((button) => button.addEventListener('click', () => {
    openColumnModal(allTables.find((item) => item.id === button.dataset.addColumn));
  }));
  list.querySelectorAll('[data-edit-table]').forEach((button) => button.addEventListener('click', () => {
    openTableModal(allTables.find((item) => item.id === button.dataset.editTable));
  }));
  list.querySelectorAll('[data-delete-table]').forEach((button) => button.addEventListener('click', async () => {
    const table = allTables.find((item) => item.id === button.dataset.deleteTable);
    if (!table) return;
    if (!await confirmDelete(`¿Eliminar la tabla “${table.name}” y sus ${table.columns.length} columnas?`)) return;
    try {
      await sddApi(`/sdd/db/tables/${table.id}`, { method: 'DELETE' });
      showToast('Tabla eliminada');
      renderSddDatabase();
    } catch (error) { showToast(error.message, true); }
  }));
  list.querySelectorAll('[data-edit-column]').forEach((button) => {
    const table = allTables.find((item) => item.columns.some((column) => column.id === button.dataset.editColumn));
    const column = table?.columns.find((item) => item.id === button.dataset.editColumn);
    if (table && column) button.addEventListener('click', () => openColumnModal(table, column));
  });
  list.querySelectorAll('[data-delete-column]').forEach((button) => button.addEventListener('click', async () => {
    try {
      await sddApi(`/sdd/db/columns/${button.dataset.deleteColumn}`, { method: 'DELETE' });
      showToast('Columna eliminada');
      renderSddDatabase();
    } catch (error) { showToast(error.message, true); }
  }));
}

function openTableModal(existing = null) {
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="sdd-table-modal-title"><div class="modal-head"><div><h2 id="sdd-table-modal-title">${existing ? 'Editar tabla' : 'Añadir tabla'}</h2></div><button class="modal-close" data-close-modal aria-label="Cerrar">×</button></div><div class="modal-body"><div class="form-grid"><label class="form-label">Nombre<input id="table-name" class="field" type="text" value="${escapeHtml(existing?.name || '')}" placeholder="Ej. usuarios, pedidos, documentos" maxlength="120" autocomplete="off" autofocus /></label><label class="form-label">Descripción<textarea id="table-description" class="textarea" maxlength="2000" placeholder="Propósito de la tabla, qué representa en el dominio…">${escapeHtml(existing?.description || '')}</textarea></label></div></div><div class="modal-actions"><button class="btn btn-secondary" data-close-modal type="button">Cancelar</button><button id="table-add-column" class="btn btn-secondary" type="button">＋ Añadir columna</button><button id="table-save" class="btn btn-primary" type="button">${existing ? 'Guardar cambios' : 'Añadir tabla'}</button></div></div></div>`;
  bindModalClose();

  const saveTable = () => {
    const body = { name: $('#table-name').value.trim(), description: $('#table-description').value };
    return sddApi(existing ? `/sdd/db/tables/${existing.id}` : '/sdd/db/tables', { method: existing ? 'PUT' : 'POST', body: JSON.stringify(body) });
  };

  $('#table-add-column').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const table = await saveTable();
      closeModal();
      showToast(existing ? 'Tabla actualizada' : 'Tabla creada');
      openColumnModal(table);
    } catch (error) {
      showToast(error.message, true);
      button.disabled = false;
    }
  });

  $('#table-save').addEventListener('click', async () => {
    try {
      await saveTable();
      closeModal();
      showToast(existing ? 'Tabla actualizada' : 'Tabla creada');
      renderSddDatabase();
    } catch (error) { showToast(error.message, true); }
  });
}

function openColumnModal(table, existing = null) {
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="sdd-column-modal-title"><div class="modal-head"><div><h2 id="sdd-column-modal-title">${existing ? 'Editar columna' : 'Añadir columna'}</h2><p>Tabla <strong>${escapeHtml(table.name)}</strong></p></div><button class="modal-close" data-close-modal aria-label="Cerrar">×</button></div><div class="modal-body"><div class="form-grid"><label class="form-label">Nombre<input id="column-name" class="field" type="text" value="${escapeHtml(existing?.name || '')}" placeholder="Ej. id, nombre, created_at" maxlength="120" autocomplete="off" autofocus /></label><label class="form-label">Tipo<input id="column-type" class="field" type="text" value="${escapeHtml(existing?.type || '')}" placeholder="Ej. INTEGER, VARCHAR(255), TEXT, BOOLEAN" maxlength="60" autocomplete="off" /></label><div class="form-grid two"><label class="sdd-check-label"><input id="column-pk" type="checkbox"${existing?.primaryKey ? ' checked' : ''} /><span>Clave primaria</span></label><label class="sdd-check-label"><input id="column-nullable" type="checkbox"${existing ? (existing.nullable ? ' checked' : '') : ' checked'} /><span>Permite NULL</span></label></div><label class="form-label">Valor por defecto<input id="column-default" class="field" type="text" value="${escapeHtml(existing?.defaultValue || '')}" placeholder="Ej. 0, now(), 'pendiente'" maxlength="200" autocomplete="off" /></label><label class="form-label">Descripción<textarea id="column-description" class="textarea" maxlength="1000" placeholder="Qué almacena esta columna, semántica, formato…">${escapeHtml(existing?.description || '')}</textarea></label></div></div><div class="modal-actions"><button class="btn btn-secondary" data-close-modal type="button">Cancelar</button><button id="column-save" class="btn btn-primary" type="button">${existing ? 'Guardar cambios' : 'Añadir columna'}</button></div></div></div>`;
  bindModalClose();
  $('#column-save').addEventListener('click', async () => {
    try {
      const body = {
        name: $('#column-name').value.trim(),
        type: $('#column-type').value.trim(),
        primaryKey: $('#column-pk').checked,
        nullable: $('#column-nullable').checked,
        defaultValue: $('#column-default').value.trim(),
        description: $('#column-description').value
      };
      const url = existing
        ? `/sdd/db/columns/${existing.id}`
        : `/sdd/db/tables/${table.id}/columns`;
      await sddApi(url, { method: existing ? 'PUT' : 'POST', body: JSON.stringify(body) });
      closeModal();
      showToast(existing ? 'Columna actualizada' : 'Columna añadida');
      renderSddDatabase();
    } catch (error) { showToast(error.message, true); }
  });
}

export function renderSddDatabase() {
  const container = $('#view-sdd-database');
  if (!container) return;
  if (renderSddProjectRequired(container, 'database', 'Base de datos')) return;
  const requestId = ++renderRequestId;
  const filterDefinitions = SDD_FILTER_DEFINITIONS.database;
  container.innerHTML = `${sddHeader('database', 'Base de datos')}${sddToolbar('Tablas', '…', 'sdd-db-add', '＋ Añadir tabla')}${sddFilterBar('database', 'Filtros de tablas', 'Buscar tabla, columna o tipo…', filterDefinitions)}<div class="sdd-list" id="sdd-db-list"><div class="empty">Cargando esquema…</div></div>`;
  moveSddToolbarActionsToHeader(container);
  $('#sdd-db-add').addEventListener('click', () => openTableModal());
  let tables = null;
  const render = () => {
    if (tables !== null) renderTableList(tables);
  };
  bindSddFilterBar('database', render, filterDefinitions);
  sddApi('/sdd/db').then(({ tables: loadedTables }) => {
    if (requestId !== renderRequestId || !isViewActive('view-sdd-database')) return;
    tables = Array.isArray(loadedTables) ? loadedTables : [];
    render();
  }).catch((error) => {
    if (requestId !== renderRequestId || !isViewActive('view-sdd-database')) return;
    $('#sdd-db-list').innerHTML = emptyState('No se pudo cargar', error.message);
  });
}

/* ---------------------------------------------------------------------- UI */

function mediaBadge(kind) {
  return `<span class="sdd-badge sdd-badge-kind">${MEDIA_KIND[kind] || escapeHtml(kind)}</span>`;
}

function mediaFrame(item) {
  if (item.kind === 'text') return `<div class="sdd-media-text">${escapeHtml(item.content)}</div>`;
  if (item.fileMissing || !item.fileUrl) return `<div class="sdd-media-text">No se encuentra el fichero en ${SPECS_FOLDER_NAME}/${SPECS_RESOURCES_FOLDER_NAME}.</div>`;
  if (item.kind === 'image') return `<img src="${escapeHtml(item.fileUrl)}" alt="${escapeHtml(item.title)}" loading="lazy" />`;
  if (item.kind === 'video') return `<video src="${escapeHtml(item.fileUrl)}" controls preload="metadata"></video>`;
  if (item.kind === 'audio') return `<audio src="${escapeHtml(item.fileUrl)}" controls preload="metadata"></audio>`;
  return '<div class="sdd-media-text"></div>';
}

function mediaCard(item) {
  return `<article class="sdd-media-card" data-media-id="${escapeHtml(item.id)}">
    <div class="sdd-media-frame">${mediaFrame(item)}</div>
    <div class="sdd-media-copy">
      <h3 class="sdd-card-title">${escapeHtml(item.title)}</h3>
      ${item.description ? `<p class="sdd-card-desc">${escapeHtml(item.description)}</p>` : ''}
      <div class="sdd-media-meta">${mediaBadge(item.kind)}<span>${escapeHtml(shortDate(item.updatedAt))}</span></div>
    </div>
    <div class="sdd-card-actions sdd-media-actions">
      <button class="btn btn-secondary btn-small" type="button" data-edit-media="${escapeHtml(item.id)}">Editar</button>
      <button class="btn btn-danger btn-small" type="button" data-delete-media="${escapeHtml(item.id)}">Eliminar</button>
    </div>
  </article>`;
}

function renderMediaList(items) {
  const allItems = Array.isArray(items) ? items : [];
  const visibleItems = sortSddMedia(filterSddMedia(allItems));
  const count = $('#sdd-ui-add-count');
  if (count) count.textContent = sddCollectionCount(visibleItems.length, allItems.length, 'contenido', 'contenidos');
  const list = $('#sdd-ui-list');
  if (!list) return;
  list.innerHTML = visibleItems.length
    ? visibleItems.map(mediaCard).join('')
    : allItems.length
      ? emptyState('Sin resultados', 'Prueba con otros filtros.')
      : emptyState('Sin contenido', 'Usa “＋ Añadir contenido”.');
  list.querySelectorAll('[data-edit-media]').forEach((button) => button.addEventListener('click', () => {
    const item = allItems.find((media) => media.id === button.dataset.editMedia);
    if (item) openMediaModal(item);
  }));
  list.querySelectorAll('[data-delete-media]').forEach((button) => button.addEventListener('click', async () => {
    const item = allItems.find((media) => media.id === button.dataset.deleteMedia);
    if (!item) return;
    if (!await confirmDelete(`¿Eliminar el contenido “${item.title}”?`)) return;
    try {
      await sddApi(`/sdd/media/${item.id}`, { method: 'DELETE' });
      showToast('Contenido eliminado');
      renderSddUi();
    } catch (error) { showToast(error.message, true); }
  }));
}

function mediaPreviewMarkup(kind, dataUrl, name) {
  if (!dataUrl) return '';
  if (kind === 'image') return `<div class="sdd-media-preview"><img src="${dataUrl}" alt="Vista previa" /></div>`;
  if (kind === 'video') return `<div class="sdd-media-preview"><video src="${dataUrl}" controls preload="metadata"></video></div>`;
  if (kind === 'audio') return `<div class="sdd-media-preview"><audio src="${dataUrl}" controls preload="metadata"></audio></div>`;
  return '';
}

function renderMediaFormBody(kind) {
  const zone = $('#media-file-zone');
  if (!zone) return;
  if (kind === 'text') {
    zone.innerHTML = '<label class="form-label">Contenido<textarea id="media-content" class="textarea" maxlength="20000" placeholder="Escribe el texto a mostrar en el diseño…"></textarea></label>';
    return;
  }
  const selectedName = selectedMedia.name ? escapeHtml(selectedMedia.name) : 'Ningún archivo seleccionado';
  const label = kind === 'image' ? 'imagen' : kind === 'video' ? 'vídeo' : 'audio';
  zone.innerHTML = `<div class="form-label">Archivo<div class="sdd-media-picker"><button id="media-pick-file" class="btn btn-secondary btn-small" type="button">Seleccionar ${label}…</button><span class="form-note">${selectedName}</span></div>${mediaPreviewMarkup(kind, selectedMedia.dataUrl)}</div>`;
  $('#media-pick-file').addEventListener('click', async () => {
    try {
      const file = await window.nexusData.selectSddMedia(kind);
      if (!file) return;
      selectedMedia = { dataUrl: file.dataUrl, name: file.name };
      renderMediaFormBody(kind);
    } catch (error) { showToast(error.message, true); }
  });
}

function openMediaModal(existing = null) {
  selectedMedia = { dataUrl: null, name: '' };
  const kindOptions = Object.entries(MEDIA_KIND).map(([value, label]) => `<option value="${value}"${existing?.kind === value ? ' selected' : ''}>${label}</option>`).join('');
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="sdd-media-modal-title"><div class="modal-head"><div><h2 id="sdd-media-modal-title">${existing ? 'Editar contenido' : 'Añadir contenido'}</h2></div><button class="modal-close" data-close-modal aria-label="Cerrar">×</button></div><div class="modal-body"><div class="form-grid"><label class="form-label">Título<input id="media-title" class="field" type="text" value="${escapeHtml(existing?.title || '')}" placeholder="Ej. Pantalla de inicio, Mapa del sitio, Logo" maxlength="200" autocomplete="off" autofocus /></label><div class="form-grid two"><label class="form-label">Tipo<select id="media-kind" class="select">${kindOptions}</select></label><div></div></div><label class="form-label">Descripción<textarea id="media-description" class="textarea" maxlength="5000" placeholder="Contexto del diseño, qué se muestra, decisiones visuales…">${escapeHtml(existing?.description || '')}</textarea></label><div id="media-file-zone"></div></div></div><div class="modal-actions"><button class="btn btn-secondary" data-close-modal type="button">Cancelar</button><button id="media-save" class="btn btn-primary" type="button">${existing ? 'Guardar cambios' : 'Añadir contenido'}</button></div></div></div>`;
  bindModalClose();
  const kind = existing?.kind || 'text';
  renderMediaFormBody(kind);
  if (existing?.kind === 'text') {
    const content = $('#media-content');
    if (content) content.value = existing.content || '';
  }
  $('#media-kind').addEventListener('change', (event) => renderMediaFormBody(event.target.value));
  $('#media-save').addEventListener('click', async () => {
    try {
      const saveKind = $('#media-kind').value;
      const title = $('#media-title').value.trim();
      const description = $('#media-description').value;
      if (existing) {
        const body = { title, description };
        if (existing.kind === 'text') body.content = $('#media-content')?.value || '';
        await sddApi(`/sdd/media/${existing.id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else if (saveKind === 'text') {
        const params = new URLSearchParams({ title, description, kind: 'text' });
        const bytes = new TextEncoder().encode($('#media-content').value);
        await sddApi(`/sdd/media?${params}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
      } else {
        if (!selectedMedia.dataUrl) throw new Error('Selecciona un archivo para el contenido');
        const params = new URLSearchParams({ title, description, kind: saveKind, fileName: selectedMedia.name || 'archivo' });
        await sddApi(`/sdd/media?${params}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: dataUrlToBytes(selectedMedia.dataUrl) });
      }
      closeModal();
      showToast(existing ? 'Contenido actualizado' : 'Contenido añadido');
      renderSddUi();
    } catch (error) { showToast(error.message, true); }
  });
}

export function renderSddUi() {
  const container = $('#view-sdd-ui');
  if (!container) return;
  if (renderSddProjectRequired(container, 'ui', 'UI')) return;
  const requestId = ++renderRequestId;
  const filterDefinitions = SDD_FILTER_DEFINITIONS.ui;
  container.innerHTML = `${sddHeader('ui', 'UI')}${sddToolbar('Referencias de diseño', '…', 'sdd-ui-add', '＋ Añadir contenido')}${sddFilterBar('ui', 'Filtros de referencias de diseño', 'Buscar título, descripción o contenido…', filterDefinitions)}<div class="sdd-media-grid" id="sdd-ui-list"><div class="empty">Cargando contenido…</div></div>`;
  moveSddToolbarActionsToHeader(container);
  $('#sdd-ui-add').addEventListener('click', () => openMediaModal());
  let media = null;
  const render = () => {
    if (media !== null) renderMediaList(media);
  };
  bindSddFilterBar('ui', render, filterDefinitions);
  sddApi('/sdd/media').then(({ media: loadedMedia }) => {
    if (requestId !== renderRequestId || !isViewActive('view-sdd-ui')) return;
    media = Array.isArray(loadedMedia) ? loadedMedia : [];
    render();
  }).catch((error) => {
    if (requestId !== renderRequestId || !isViewActive('view-sdd-ui')) return;
    $('#sdd-ui-list').innerHTML = emptyState('No se pudo cargar', error.message);
  });
}

/* ---------------------------------------------------------------- Recursos */

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  const units = ['KB', 'MB', 'GB'];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size >= 10 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
}

function resourceCard(resource) {
  const source = resource.fileUrl || resource.dataUrl || '';
  const frame = resource.kind === 'video'
    ? `<video src="${escapeHtml(source)}" controls preload="metadata"></video>`
    : resource.kind === 'audio'
      ? `<audio src="${escapeHtml(source)}" controls preload="metadata"></audio>`
      : resource.kind === 'image'
        ? `<img src="${escapeHtml(source)}" alt="${escapeHtml(resource.name)}" loading="lazy" />`
        : `<div class="sdd-media-text">${escapeHtml(resource.type || 'Archivo')}</div>`;
  return `<article class="sdd-media-card">
    <div class="sdd-media-frame">${frame}</div>
    <div class="sdd-media-copy">
      <h3 class="sdd-card-title">${escapeHtml(resource.name)}</h3>
      <div class="sdd-media-meta">${mediaBadge(resource.kind)}<span>${escapeHtml(formatBytes(resource.size))}</span><span>${escapeHtml(shortDate(resource.modifiedAt))}</span></div>
    </div>
    <div class="sdd-card-actions sdd-media-actions">
      <button class="btn btn-secondary btn-small" type="button" data-reveal-resource="${escapeHtml(resource.path)}" title="Mostrar “${escapeHtml(resource.name)}” en el explorador del sistema">Mostrar</button>
    </div>
  </article>`;
}

function renderResourceList(resources) {
  const allResources = Array.isArray(resources) ? resources : [];
  const visibleResources = sortSddResources(filterSddResources(allResources));
  const count = $('#sdd-resource-count');
  if (count) count.textContent = sddCollectionCount(visibleResources.length, allResources.length, 'recurso', 'recursos');
  const list = $('#sdd-resource-list');
  if (!list) return;
  list.innerHTML = visibleResources.length
    ? visibleResources.map(resourceCard).join('')
    : allResources.length
      ? emptyState('Sin resultados', 'Prueba con otros filtros.')
      : emptyState('Sin recursos multimedia', `Coloca imágenes, audios o vídeos en la carpeta “${SPECS_FOLDER_NAME}/${SPECS_RESOURCES_FOLDER_NAME}”.`);
  list.querySelectorAll('[data-reveal-resource]').forEach((button) => button.addEventListener('click', () => {
    const reveal = window.nexusData?.revealFile;
    if (typeof reveal !== 'function') {
      showToast('Mostrar en el explorador no está disponible en esta ventana', true);
      return;
    }
    reveal(button.dataset.revealResource).catch((error) => showToast(error.message, true));
  }));
}

function specsResourcesFolder() {
  return currentSddProjectPath();
}

async function readSpecsResources() {
  if (!specsResourcesFolder()) return null;
  try {
    return await sddApi('/sdd/resources');
  } catch (error) {
    const folder = specsResourcesFolder();
    if (typeof window.nexusData?.readSddSpecsResources !== 'function') throw error;
    const result = await window.nexusData.readSddSpecsResources(folder);
    return { folder: result.sddPath || result.path, resources: result.resources };
  }
}

export function renderSddResources() {
  const container = $('#view-sdd-resources');
  if (!container) return;
  const filterDefinitions = SDD_FILTER_DEFINITIONS.resources;
  if (renderSddProjectRequired(container, 'resources', 'Recursos')) return;
  container.innerHTML = `${sddHeader('resources', 'Recursos')}<div class="sdd-toolbar"><div class="sdd-toolbar-copy"><h2>Recursos multimedia</h2><span id="sdd-resource-count" class="sdd-count">…</span></div><div class="sdd-toolbar-actions"><button id="sdd-resource-refresh" class="btn btn-secondary" type="button" title="Volver a leer la carpeta de recursos">Actualizar</button></div></div>${sddFilterBar('resources', 'Filtros de recursos multimedia', 'Buscar nombre o ruta…', filterDefinitions)}<div class="sdd-card-meta sdd-resource-folder" id="sdd-resource-folder"></div><div class="sdd-media-grid" id="sdd-resource-list"><div class="empty">Cargando recursos…</div></div>`;
  moveSddToolbarActionsToHeader(container);
  let currentResources = null;
  bindSddFilterBar('resources', () => {
    if (currentResources) renderResourceList(currentResources);
  }, filterDefinitions);
  const showResources = (data, id) => {
    if (id !== renderRequestId || !isViewActive('view-sdd-resources')) return;
    const folderNode = $('#sdd-resource-folder');
    if (folderNode) folderNode.textContent = data?.folder ? `Carpeta: ${data.folder}` : '';
    if (!data) {
      const count = $('#sdd-resource-count');
      if (count) count.textContent = '…';
      $('#sdd-resource-list').innerHTML = emptyState('Sin carpeta de specs', `Usa “Proyecto” > “Cargar Proyecto” para elegir un proyecto con ${SPECS_FOLDER_NAME}.`);
      return;
    }
    currentResources = Array.isArray(data.resources) ? data.resources : [];
    renderResourceList(currentResources);
  };
  const load = () => {
    const id = ++renderRequestId;
    $('#sdd-resource-list').innerHTML = '<div class="empty">Cargando recursos…</div>';
    readSpecsResources().then((data) => showResources(data, id)).catch((error) => {
      if (id !== renderRequestId || !isViewActive('view-sdd-resources')) return;
      const count = $('#sdd-resource-count');
      if (count) count.textContent = '…';
      $('#sdd-resource-list').innerHTML = emptyState('No se pudieron cargar', error.message);
    });
  };
  $('#sdd-resource-refresh').addEventListener('click', load);
  load();
}
