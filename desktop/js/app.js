import { $ } from './core/dom.js';
import { configureApi, api } from './core/api.js';
import { loadSearchPreferences, loadSidebarSearchPreference, persistSidebarSearchPreference, state } from './core/state.js';
import { setConnection, showToast } from './ui/notifications.js';
import { showApplication } from './views/auth.js';
import { configureDocuments, openDocument } from './views/documents.js';
import { bindSidebarSearch, configureSearch, performGlobalSearch, performSearch, renderGlobalSearch, renderSearch } from './views/search.js';
import { configureSources, renderSources, syncSource } from './views/sources.js';
import { configureSourceModal } from './views/source-modal.js';
import { bindHtmlViewerMenu, configureHtmlViewer, openPersistedHtmlSource, renderHtmlViewer } from './views/html-viewer.js';
import { bindDiagramMenu, openDiagramDocument, renderDiagrams } from './views/diagrams.js';
import { configureCodeMap, renderCodeMap } from './views/code-map.js';
import { renderFavorites, renderRecentDocuments } from './views/document-collections.js';
import { renderFileExplorer } from './views/file-explorer.js';
import { renderSddSpecs, renderSddDatabase, renderSddUi, renderSddResources, bindSddInject, bindSddLoad } from './views/sdd.js';
import { bindPreferencesMenu } from './views/settings.js';
import { loadPalettePreference } from './core/theme.js';
import { loadDiagramLineContrast } from './core/diagram-settings.js';
import { bindWorkspaceControls, configureWorkspace } from './core/workspace.js';

let nativeMenuView = null;
let offlineSessionRecovery = null;

configureApi({ onUnauthorized: () => { void recoverOfflineSession(); } });

async function refreshData() {
  try {
    const [sources, collections, tags, globalProject] = await Promise.all([
      api('/sources'),
      api('/collections'),
      api('/tags'),
      api('/global-project')
    ]);
    const previousProjectPath = state.globalProject?.path || '';
    state.sources = sources;
    state.collections = collections;
    state.tags = tags;
    state.globalProject = globalProject.project || null;
    if (previousProjectPath !== (state.globalProject?.path || '')) {
      state.codeMap.files = [];
      state.codeMap.folders = [];
      state.codeMap.filesWarnings = [];
      state.codeMap.filesLoaded = false;
      state.codeMap.filesFingerprint = '';
      state.codeMap.scope = 'project';
      state.codeMap.entryFile = '';
      state.codeMap.entryFolder = '';
      state.codeMap.result = null;
      state.codeMap.selectedId = null;
      state.codeMap.selectedRelationId = null;
      state.codeMap.stale = false;
    }
    setConnection('offline', '');
    renderView();
    if (state.view === 'search') await performSearch();
    if (state.view === 'global-search') await performGlobalSearch();
  } catch (error) {
    setConnection('error', 'Aplicación local no disponible');
    showToast(error.message, true);
  }
}

function renderView() {
  if (nativeMenuView !== state.view && typeof window.nexusData?.setViewMenu === 'function') {
    nativeMenuView = state.view;
    window.nexusData.setViewMenu(state.view).catch(() => { nativeMenuView = null; });
  }
  document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.id === `view-${state.view}`));
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === state.view));
  if (state.view === 'search') renderSearch();
  if (state.view === 'global-search') renderGlobalSearch();
  if (state.view === 'recent-documents') renderRecentDocuments();
  if (state.view === 'favorites') renderFavorites();
  if (state.view === 'html-viewer') renderHtmlViewer();
  if (state.view === 'diagrams') renderDiagrams();
  if (state.view === 'code-map') renderCodeMap();
  if (state.view === 'sources') renderSources();
  if (state.view === 'file-explorer') renderFileExplorer();
  if (state.view === 'sdd-specs') renderSddSpecs();
  if (state.view === 'sdd-database') renderSddDatabase();
  if (state.view === 'sdd-ui') renderSddUi();
  if (state.view === 'sdd-resources') renderSddResources();
}

async function initialiseSession() {
  state.user = { id: 'offline', username: 'Modo offline', offline: true };
  showApplication();
  try {
    const result = await api('/auth/offline', { method: 'POST' });
    state.user = result.user;
    await refreshData();
  } catch (error) {
    setConnection('error', 'Aplicación local no disponible');
    showToast(error.message, true);
  }
}

function recoverOfflineSession() {
  if (!offlineSessionRecovery) {
    offlineSessionRecovery = initialiseSession().finally(() => { offlineSessionRecovery = null; });
  }
  return offlineSessionRecovery;
}

function bindNavigation() {
  document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => {
    state.view = button.dataset.view;
    renderView();
    if (state.view === 'search') performSearch();
    if (state.view === 'global-search') performGlobalSearch();
  }));
}

function renderSidebarSearch() {
  const toggle = $('#sidebar-search-toggle');
  const field = $('#sidebar-search-field');
  const input = $('#sidebar-search-input');
  if (!toggle || !field || !input) return;
  const expanded = state.sidebarSearchExpanded;
  field.hidden = !expanded;
  input.value = state.searchQuery;
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.setAttribute('aria-label', expanded ? 'Ocultar búsqueda rápida' : 'Mostrar búsqueda rápida');
  toggle.title = expanded ? 'Ocultar búsqueda rápida' : 'Mostrar búsqueda rápida';
  toggle.textContent = expanded ? '⌃' : '⌄';
}

function bindSidebarSearchToggle() {
  state.sidebarSearchExpanded = loadSidebarSearchPreference();
  renderSidebarSearch();
  $('#sidebar-search-toggle')?.addEventListener('click', () => {
    persistSidebarSearchPreference(!state.sidebarSearchExpanded);
    renderSidebarSearch();
    if (state.sidebarSearchExpanded) $('#sidebar-search-input')?.focus();
  });
}

function showCloseConfirmation() {
  if ($('#close-confirmation')) return;
  document.body.insertAdjacentHTML('beforeend', `<div id="close-confirmation" class="modal-backdrop close-confirmation-backdrop"><div class="modal close-confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="close-confirmation-title" aria-describedby="close-confirmation-description"><div class="modal-head"><div><h2 id="close-confirmation-title">Cerrar aplicación</h2></div></div><div class="modal-body"><p id="close-confirmation-description">¿Quieres salir?</p></div><div class="modal-actions"><button id="close-confirmation-cancel" class="btn btn-primary close-confirmation-cancel" type="button">Cancelar</button><button id="close-confirmation-submit" class="btn btn-secondary" type="button">Cerrar</button></div></div></div>`);
  const modal = $('#close-confirmation');
  const resolve = (confirmed) => {
    modal.remove();
    window.nexusData.resolveCloseConfirmation(confirmed);
  };
  $('#close-confirmation-cancel').addEventListener('click', () => resolve(false));
  $('#close-confirmation-submit').addEventListener('click', () => resolve(true));
  modal.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') resolve(false);
  });
  $('#close-confirmation-cancel').focus();
}

function bindCloseConfirmation() {
  window.nexusData?.onCloseConfirmationRequest?.(showCloseConfirmation);
}

configureHtmlViewer({ onNavigate: (view) => { state.view = view; renderView(); } });
configureDocuments({
  onRefresh: refreshData,
  onOpenHtmlViewer: openPersistedHtmlSource,
  onOpenDiagram: (diagramDocument) => {
    state.view = 'diagrams';
    renderView();
    openDiagramDocument(diagramDocument);
  }
});
configureSearch({ onRefresh: refreshData, onNavigate: (view) => { state.view = view; renderView(); } });
configureSources({ onRefresh: refreshData });
configureSourceModal({ onRefresh: refreshData, onSync: syncSource });
configureCodeMap({ onNavigate: (view) => { state.view = view; renderView(); } });
configureWorkspace({ onRefresh: refreshData });
bindHtmlViewerMenu();
bindDiagramMenu();
bindPreferencesMenu();
bindWorkspaceControls();
bindNavigation();
bindSidebarSearchToggle();
bindSidebarSearch();
bindCloseConfirmation();
bindSddInject();
bindSddLoad();
loadPalettePreference();
loadDiagramLineContrast();

async function startApplication() {
  await loadSearchPreferences();
  renderSidebarSearch();
  await recoverOfflineSession();
}

startApplication();
