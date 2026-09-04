import { escapeHtml } from '../core/dom.js';
import { normaliseFileExplorerViewMode } from './file-explorer-state.js';
import {
  breadcrumbSegments,
  entryIcon,
  entryIconTone,
  entrySecondaryText,
  fileExplorerIconMarkup,
  pathName,
  rootIconTone,
  entryTypeLabel,
  formatBytes,
  formatModifiedAt,
  selectionSummary,
  visibleFileExplorerEntries
} from './file-explorer-format.js';

function actionButton(action, label, disabled = false, className = 'btn btn-secondary btn-small') {
  return `<button type="button" class="${className}" data-file-explorer-action="${action}"${disabled ? ' disabled' : ''}>${label}</button>`;
}

function contextActionButton(action, label, className = 'file-explorer-context-action', disabled = false) {
  return `<button type="button" class="${className}" data-file-explorer-context-action="${action}" role="menuitem"${disabled ? ' disabled' : ''}>${label}</button>`;
}

function viewModeButton(mode, label, icon, state) {
  const selected = normaliseFileExplorerViewMode(state.viewMode) === mode;
  return `<button type="button" class="file-explorer-view-button${selected ? ' is-active' : ''}" data-file-explorer-action="view-mode" data-file-explorer-view-mode="${mode}" aria-pressed="${selected}" title="${label}"><span aria-hidden="true">${icon}</span><span>${label}</span></button>`;
}

function navigationButton(action, label, disabled = false, title = '') {
  return `<button type="button" class="file-explorer-nav-button file-explorer-nav-button-${action}" data-file-explorer-action="${action}"${disabled ? ' disabled' : ''}${title ? ` title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"` : ''}>${label}</button>`;
}

function navigationMarkup(state) {
  const canGoBack = state.historyIndex > 0 && !state.loading;
  const canGoForward = state.historyIndex < state.history.length - 1 && !state.loading;
  const canGoParent = Boolean(state.currentPath && state.parentPath && state.parentPath !== state.currentPath && !state.loading);
  return `<div class="file-explorer-toolbar"><div class="file-explorer-navigation-actions"><div class="file-explorer-history-actions" role="group" aria-label="Historial de navegación">${navigationButton('back', '←', !canGoBack, 'Atrás')}${navigationButton('forward', '→', !canGoForward, 'Adelante · volver')}</div>${navigationButton('home', 'Inicio', state.loading, 'Este equipo')}${navigationButton('parent', '↑', !canGoParent, 'Subir')}</div><form id="file-explorer-path-form" class="file-explorer-path-form"><input id="file-explorer-path" class="file-explorer-path-input" type="text" value="${escapeHtml(state.currentPath || '')}" placeholder="C:\\Users\\…" autocomplete="off" spellcheck="false" aria-label="Ruta local" /><button class="btn btn-primary btn-small" type="submit"${state.loading ? ' disabled' : ''}>Ir</button></form></div>`;
}

function filterMarkup(state) {
  const searchValue = state.searchActive ? state.query : '';
  const searchDisabled = state.loading || (!state.currentPath && !state.roots.length);
  const searchPlaceholder = state.currentPath ? 'Buscar en esta carpeta…' : 'Buscar desde Inicio…';
  return `<div class="file-explorer-filterbar"><form id="file-explorer-search-form" class="file-explorer-search-form"><span aria-hidden="true">⌕</span><input id="file-explorer-search" type="search" value="${escapeHtml(searchValue)}" placeholder="${searchPlaceholder}" aria-label="Buscar ficheros"${searchDisabled ? ' disabled' : ''} /><button class="btn btn-secondary btn-small" type="submit"${searchDisabled ? ' disabled' : ''}>Buscar</button></form><label class="file-explorer-check"><input type="checkbox" data-file-explorer-action="toggle-hidden"${state.showHidden ? ' checked' : ''}${state.loading ? ' disabled' : ''} />Ocultos</label><label class="file-explorer-sort"><span>Ordenar</span><select id="file-explorer-sort" data-file-explorer-action="sort"${state.loading ? ' disabled' : ''}><option value="name"${state.sortBy === 'name' ? ' selected' : ''}>Nombre</option><option value="type"${state.sortBy === 'type' ? ' selected' : ''}>Tipo</option><option value="size"${state.sortBy === 'size' ? ' selected' : ''}>Tamaño</option><option value="modified"${state.sortBy === 'modified' ? ' selected' : ''}>Modificación</option></select></label>${actionButton('sort-direction', state.sortDirection === 'asc' ? '↑' : '↓', state.loading, 'btn btn-secondary btn-small file-explorer-sort-direction')}<div class="file-explorer-view-switcher" role="group" aria-label="Forma de visualización">${viewModeButton('list', 'Lista', '≡', state)}${viewModeButton('grid', 'Cuadrícula', '⊞', state)}${viewModeButton('details', 'Detalles', '☷', state)}</div></div>`;
}

function breadcrumbsMarkup(state) {
  if (!state.currentPath) return '';
  const segments = breadcrumbSegments(state.currentPath);
  const crumbs = segments.map((segment, index) => `<button type="button" class="file-explorer-breadcrumb${index === segments.length - 1 ? ' is-current' : ''}" data-file-explorer-action="open-path" data-file-explorer-path="${escapeHtml(segment.path)}"${index === segments.length - 1 ? ' aria-current="location"' : ''}>${escapeHtml(segment.label)}</button>`).join('<span aria-hidden="true">›</span>');
  return `<nav class="file-explorer-breadcrumbs" aria-label="Ruta actual">${crumbs}${state.searchActive ? '<span class="file-explorer-search-badge">Resultados</span>' : ''}</nav>`;
}

function selectionMarkup(state) {
  const summary = selectionSummary(state);
  const clipboardLabel = state.clipboard.paths.length
    ? `${state.clipboard.operation === 'cut' ? 'Cortar' : 'Copiar'} · ${state.clipboard.paths.length}`
    : '';
  if (!summary && !clipboardLabel) return '';
  return `<div class="file-explorer-selectionbar"><span class="file-explorer-selection-summary">${escapeHtml(summary)}${clipboardLabel ? `${summary ? ' ' : ''}<small>${escapeHtml(`(${clipboardLabel})`)}</small>` : ''}</span></div>`;
}
function rootMarkup(root) {
  const iconTone = rootIconTone(root);
  return `<button type="button" class="file-explorer-root-row" data-file-explorer-action="open-root" data-file-explorer-path="${escapeHtml(root.path)}"><span class="file-explorer-root-icon file-explorer-icon-tone-${iconTone}" aria-hidden="true">${fileExplorerIconMarkup(iconTone)}</span><span class="file-explorer-root-copy"><strong>${escapeHtml(root.label)}</strong><small title="${escapeHtml(root.path)}">${escapeHtml(root.path)}</small></span><span class="file-explorer-entry-arrow" aria-hidden="true">›</span></button>`;
}

function rootsMarkup(state) {
  const shortcuts = state.roots.filter((root) => root.kind !== 'drive');
  const drives = state.roots.filter((root) => root.kind === 'drive');
  if (!state.roots.length) return '<div class="file-explorer-empty"><strong>No se encontraron ubicaciones locales</strong><span>Comprueba que el sistema tenga alguna carpeta accesible.</span></div>';
  return `${shortcuts.length ? `<section class="file-explorer-root-group"><div class="file-explorer-group-head"><h2>Accesos rápidos</h2><span>${shortcuts.length}</span></div><div class="file-explorer-root-list file-explorer-root-list-${normaliseFileExplorerViewMode(state.viewMode)}">${shortcuts.map(rootMarkup).join('')}</div></section>` : ''}${drives.length ? `<section class="file-explorer-root-group"><div class="file-explorer-group-head"><h2>Unidades</h2><span>${drives.length}</span></div><div class="file-explorer-root-list file-explorer-root-list-${normaliseFileExplorerViewMode(state.viewMode)}">${drives.map(rootMarkup).join('')}</div></section>` : ''}`;
}

function entryMarkup(entry, index, state) {
  const selected = state.selectedPaths.has(entry.path);
  const search = state.searchActive;
  const action = entry.kind === 'directory' ? 'Abrir carpeta' : 'Abrir fichero';
  const viewMode = normaliseFileExplorerViewMode(state.viewMode);
  const details = viewMode === 'details'
    ? `<span class="file-explorer-entry-detail file-explorer-entry-detail-type">${escapeHtml(entryTypeLabel(entry))}</span><span class="file-explorer-entry-detail file-explorer-entry-detail-size">${escapeHtml(formatBytes(entry.size))}</span><span class="file-explorer-entry-detail file-explorer-entry-detail-modified">${escapeHtml(formatModifiedAt(entry.modifiedAt) || '—')}</span>`
    : '';
  return `<button type="button" class="file-explorer-entry file-explorer-entry-${escapeHtml(entry.kind)}${selected ? ' is-selected' : ''}" data-file-explorer-entry="${escapeHtml(entry.path)}" data-file-explorer-kind="${escapeHtml(entry.kind)}" data-file-explorer-index="${index}" role="option" aria-selected="${selected}" aria-label="${action} ${escapeHtml(entry.name)}"><span class="file-explorer-entry-icon file-explorer-icon-tone-${entryIconTone(entry)}" aria-hidden="true">${entryIcon(entry)}</span><span class="file-explorer-entry-copy"><strong title="${escapeHtml(entry.name)}">${escapeHtml(entry.name)}</strong><small title="${escapeHtml(entry.relativePath || '')}">${escapeHtml(entrySecondaryText(entry, { search }))}</small></span>${details}<span class="file-explorer-entry-arrow" aria-hidden="true">${entry.kind === 'directory' ? '›' : '↗'}</span></button>`;
}

function entryDetailsHeader() {
  return '<div class="file-explorer-entry-details-head" aria-hidden="true"><span></span><span>Nombre</span><span>Tipo</span><span>Tamaño</span><span class="file-explorer-entry-detail-modified">Modificado</span><span></span></div>';
}

function directoryMarkup(state) {
  const visibleEntries = visibleFileExplorerEntries(state);
  const viewMode = normaliseFileExplorerViewMode(state.viewMode);
  const totalLabel = state.entriesTruncated
    ? `Mostrando ${visibleEntries.length} de ${state.totalEntries} elementos`
    : `${visibleEntries.length} elemento${visibleEntries.length === 1 ? '' : 's'}`;
  if (!visibleEntries.length) {
    const title = state.searchActive ? 'No hay coincidencias' : 'Esta carpeta está vacía';
    const description = state.searchActive ? 'Prueba con otro término de búsqueda.' : 'No hay elementos que mostrar.';
    return `<div class="file-explorer-empty"><strong>${title}</strong><span>${description}</span></div>`;
  }
  return `<div class="file-explorer-directory-head"><div><strong>${escapeHtml(state.searchActive ? 'Resultados' : pathName(state.currentPath))}</strong><span>${escapeHtml(totalLabel)}${state.searchTruncated ? ' · búsqueda limitada' : ''}</span></div>${state.searchActive ? actionButton('clear-search', 'Limpiar', false, 'btn btn-secondary btn-small') : ''}</div>${viewMode === 'details' ? entryDetailsHeader() : ''}<div class="file-explorer-entry-list file-explorer-entry-list-${viewMode}" role="listbox" aria-label="Contenido de la carpeta">${visibleEntries.map((entry, index) => entryMarkup(entry, index, state)).join('')}</div>`;
}

function bodyMarkup(state) {
  if (state.loading) return `<div class="file-explorer-loading"><span class="spinner"></span><strong>${state.loadingKind === 'search' ? 'Buscando…' : state.loadingKind === 'operation' ? 'Aplicando cambios…' : 'Leyendo carpeta…'}</strong></div>`;
  if (state.errorMessage) return `<div class="file-explorer-error"><strong>No se puede completar la operación</strong><span>${escapeHtml(state.errorMessage)}</span>${actionButton('refresh', 'Reintentar')}</div>`;
  return state.currentPath ? directoryMarkup(state) : rootsMarkup(state);
}

function contextMenuMarkup(state) {
  if (!state.contextMenu) return '';
  const path = state.contextMenu.path;
  const hasTarget = Boolean(path);
  const selectedCount = state.selectedPaths.size;
  const canManage = Boolean(path || selectedCount);
  const hasSingleSelection = selectedCount === 1;
  const canPaste = Boolean(state.currentPath && state.clipboard.paths.length && !state.loading);
  const position = `left:${Math.max(8, Number(state.contextMenu.x) || 8)}px;top:${Math.max(8, Number(state.contextMenu.y) || 8)}px`;
  return `<div class="file-explorer-context-menu" style="${position}" role="menu" aria-label="Acciones del explorador">${hasTarget ? `${contextActionButton('context-open', 'Abrir')}${contextActionButton('context-copy', 'Copiar', 'file-explorer-context-action', !canManage)}${contextActionButton('context-cut', 'Cortar', 'file-explorer-context-action', !canManage)}${contextActionButton('context-copy-path', 'Copiar ruta', 'file-explorer-context-action', !canManage)}${contextActionButton('context-reveal', 'Mostrar en el sistema', 'file-explorer-context-action', !hasSingleSelection)}${contextActionButton('context-rename', 'Renombrar', 'file-explorer-context-action', !hasSingleSelection)}${contextActionButton('context-delete', 'Eliminar', 'file-explorer-context-action file-explorer-context-danger', !canManage)}` : ''}${contextActionButton('context-new-folder', 'Nueva carpeta', 'file-explorer-context-action', !state.currentPath || state.loading)}${contextActionButton('context-new-file', 'Nuevo fichero', 'file-explorer-context-action', !state.currentPath || state.loading)}${state.clipboard.paths.length ? contextActionButton('context-paste', 'Pegar', 'file-explorer-context-action', !canPaste) : ''}</div>`;
}

export function renderFileExplorerView(container, state) {
  container.innerHTML = `<div class="file-explorer-shell">${navigationMarkup(state)}${filterMarkup(state)}${breadcrumbsMarkup(state)}${selectionMarkup(state)}<main class="file-explorer-content">${bodyMarkup(state)}</main>${contextMenuMarkup(state)}</div>`;
}
