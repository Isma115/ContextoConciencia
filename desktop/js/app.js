import { $ } from './core/dom.js';
import { configureApi, api } from './core/api.js';
import { loadSearchPreferences, state } from './core/state.js';
import { setConnection, showToast } from './ui/notifications.js';
import { showApplication, showAuthentication } from './views/auth.js';
import { configureDocuments, openDocument } from './views/documents.js';
import { configureSearch, performGlobalSearch, performSearch, renderGlobalSearch, renderSearch } from './views/search.js';
import { configureSources, renderSources, syncSource } from './views/sources.js';
import { configureSourceModal } from './views/source-modal.js';
import { bindHtmlViewerMenu, configureHtmlViewer, openPersistedHtmlSource, renderHtmlViewer } from './views/html-viewer.js';
import { renderDiagrams } from './views/diagrams.js';
import { configureSettings, renderSettings } from './views/settings.js';

let nativeMenuView = null;

configureApi({ onUnauthorized: () => showAuthentication('', { onAuthenticated }) });

async function refreshData() {
  try {
    const [sources, collections, tags, globalProject, stats] = await Promise.all([
      api('/sources'),
      api('/collections'),
      api('/tags'),
      api('/global-project'),
      api('/stats')
    ]);
    state.sources = sources;
    state.collections = collections;
    state.tags = tags;
    state.globalProject = globalProject.project || null;
    state.stats = stats;
    setConnection('online', 'API local conectada');
    renderView();
    if (state.view === 'search') await performSearch();
    if (state.view === 'global-search' && state.globalProject) await performGlobalSearch();
  } catch (error) {
    setConnection('error', 'API no disponible');
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
  if (state.view === 'html-viewer') renderHtmlViewer();
  if (state.view === 'diagrams') renderDiagrams();
  if (state.view === 'sources') renderSources();
  if (state.view === 'settings') renderSettings();
}

async function onAuthenticated() {
  showApplication();
  await refreshData();
}

async function initialiseSession() {
  try {
    const result = await api('/auth/me');
    state.user = result.user;
    await onAuthenticated();
  } catch (error) {
    showAuthentication(error.status === 503 ? error.message : '', { onAuthenticated });
  }
}

function bindNavigation() {
  document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => {
    state.view = button.dataset.view;
    renderView();
    if (state.view === 'search') performSearch();
    if (state.view === 'global-search') performGlobalSearch();
  }));
  $('#logout-button').addEventListener('click', async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* La vista se cierra aunque el servidor ya no esté disponible. */ }
    showAuthentication('', { onAuthenticated });
  });
}

function showCloseConfirmation() {
  if ($('#close-confirmation')) return;
  document.body.insertAdjacentHTML('beforeend', `<div id="close-confirmation" class="modal-backdrop close-confirmation-backdrop"><div class="modal close-confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="close-confirmation-title" aria-describedby="close-confirmation-description"><div class="modal-head"><div><h2 id="close-confirmation-title">Cerrar NexusData</h2><p>Se cerrará la ventana y el servidor local.</p></div></div><div class="modal-body"><p id="close-confirmation-description">¿Quieres cerrar la aplicación?</p></div><div class="modal-actions"><button id="close-confirmation-cancel" class="btn btn-primary close-confirmation-cancel" type="button">Cancelar</button><button id="close-confirmation-submit" class="btn btn-secondary" type="button">Cerrar</button></div></div></div>`);
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
configureDocuments({ onRefresh: refreshData, onOpenHtmlViewer: openPersistedHtmlSource });
configureSearch({ onRefresh: refreshData });
configureSources({ onRefresh: refreshData });
configureSourceModal({ onRefresh: refreshData, onSync: syncSource });
configureSettings({ onRefresh: refreshData });
bindHtmlViewerMenu();
bindNavigation();
bindCloseConfirmation();

async function startApplication() {
  await loadSearchPreferences();
  await initialiseSession();
}

startApplication();
