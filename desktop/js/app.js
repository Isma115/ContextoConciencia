import { $ } from './core/dom.js';
import { configureApi, api } from './core/api.js';
import { state } from './core/state.js';
import { setConnection, showToast } from './ui/notifications.js';
import { showApplication, showAuthentication } from './views/auth.js';
import { configureDocuments, openDocument } from './views/documents.js';
import { configureSearch, performGlobalSearch, performSearch, renderGlobalSearch, renderSearch } from './views/search.js';
import { configureSources, renderSources, syncSource } from './views/sources.js';
import { configureSourceModal } from './views/source-modal.js';
import { bindHtmlViewerMenu, renderHtmlViewer } from './views/html-viewer.js';
import { renderSettings } from './views/settings.js';

let nativeMenuView = null;

configureApi({ onUnauthorized: () => showAuthentication('', { onAuthenticated }) });

async function refreshData() {
  try {
    const [sources, collections, tags, globalProject] = await Promise.all([
      api('/sources'),
      api('/collections'),
      api('/tags'),
      api('/global-project')
    ]);
    state.sources = sources;
    state.collections = collections;
    state.tags = tags;
    state.globalProject = globalProject.project || null;
    setConnection('online', 'API local conectada');
    renderView();
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

configureDocuments({ onRefresh: refreshData });
configureSearch({ onRefresh: refreshData });
configureSources({ onRefresh: refreshData });
configureSourceModal({ onRefresh: refreshData, onSync: syncSource });
bindHtmlViewerMenu();
bindNavigation();
initialiseSession();
