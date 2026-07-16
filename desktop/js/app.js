const queryParams = new URLSearchParams(window.location.search);
const configuredBase = window.nexusData?.apiBase || queryParams.get('apiBase') || window.location.origin;
const API = `${configuredBase.replace(/\/$/, '')}/api`;
const SEARCH_DEBOUNCE_MS = 500;
let searchDebounceTimer = null;
let searchRequestId = 0;

const state = {
  view: 'dashboard',
  stats: null,
  sources: [],
  collections: [],
  tags: [],
  searchQuery: '',
  filters: { source: '', type: '', tag: '', collection: '', date: '' },
  selectedCollection: null,
  user: null
};

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[character]));

async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, { credentials: 'include', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { error: text }; }
  if (!response.ok) {
    const error = new Error(payload.error || `Error ${response.status}`);
    error.status = response.status;
    if (response.status === 401 && state.user && !path.startsWith('/auth/')) showAuthentication();
    throw error;
  }
  return payload;
}

function showAuthentication(message = '') {
  state.user = null;
  $('.app-shell').setAttribute('aria-hidden', 'true');
  $('.app-shell').classList.add('app-hidden');
  $('#auth-screen').classList.add('visible');
  $('#auth-screen').innerHTML = `<div class="auth-card"><div class="auth-brand"><strong>NexusData</strong><span>ESPACIO DE TRABAJO TÉCNICO</span></div><h1>Accede a tu espacio</h1><p>Inicia sesión o crea una cuenta para usar NexusData.</p><div class="auth-tabs"><button class="auth-tab active" data-auth-mode="login">Iniciar sesión</button><button class="auth-tab" data-auth-mode="register">Crear cuenta</button></div><form id="auth-form" class="auth-form" novalidate><label class="form-label">Usuario<input id="auth-username" class="field" autocomplete="username" minlength="3" maxlength="50" required /></label><label class="form-label">Contraseña<input id="auth-password" type="password" class="field" autocomplete="current-password" minlength="8" maxlength="32" required /></label><p id="auth-help" class="form-note">Usa entre 3 y 50 caracteres. La contraseña debe tener entre 8 y 32.</p><p id="auth-error" class="auth-error">${escapeHtml(message)}</p><button id="auth-submit" class="btn btn-primary auth-submit" type="submit">Iniciar sesión</button></form><div class="auth-offline"><span>O trabaja solo con los archivos de este equipo.</span><button id="auth-offline" class="btn btn-secondary" type="button">Entrar offline</button></div></div>`;
  let mode = 'login';
  const updateMode = () => {
    document.querySelectorAll('[data-auth-mode]').forEach((button) => button.classList.toggle('active', button.dataset.authMode === mode));
    $('#auth-submit').textContent = mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta';
    $('#auth-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    $('#auth-error').textContent = '';
  };
  document.querySelectorAll('[data-auth-mode]').forEach((button) => button.addEventListener('click', () => { mode = button.dataset.authMode; updateMode(); }));
  $('#auth-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = $('#auth-username').value;
    const password = $('#auth-password').value;
    const submit = $('#auth-submit');
    submit.disabled = true;
    try {
      const result = await api(`/auth/${mode === 'login' ? 'login' : 'register'}`, { method: 'POST', body: JSON.stringify({ username, password }) });
      state.user = result.user;
      showApplication();
      await refreshData();
    } catch (error) { $('#auth-error').textContent = error.message; }
    finally { submit.disabled = false; }
  });
  $('#auth-offline').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await api('/auth/offline', { method: 'POST' });
      state.user = result.user;
      showApplication();
      await refreshData();
    } catch (error) {
      $('#auth-error').textContent = error.message;
    } finally { button.disabled = false; }
  });
  updateMode();
  $('#auth-username').focus();
}

function showApplication() {
  $('#auth-screen').classList.remove('visible');
  $('#auth-screen').innerHTML = '';
  $('.app-shell').classList.remove('app-hidden');
  $('.app-shell').setAttribute('aria-hidden', 'false');
  $('#active-user').textContent = state.user?.username || '';
  $('#logout-button').textContent = state.user?.offline ? 'Salir del modo offline' : 'Cerrar sesión';
}

async function initialiseSession() {
  try {
    const result = await api('/auth/me');
    state.user = result.user;
    showApplication();
    await refreshData();
  } catch (error) {
    showAuthentication(error.status === 503 ? error.message : '');
  }
}

function shortDate(value) {
  if (!value) return 'Sin sincronizar';
  try { return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short' }).format(new Date(value)); } catch { return value; }
}

function typeLabel(type) {
  return ({ markdown: 'md', json: 'json', csv: 'csv', text: 'txt', rest: 'api' }[type] || type || 'doc');
}

function statusLabel(status) {
  return ({ ready: 'Lista', pending: 'Pendiente', syncing: 'Sincronizando', error: 'Con errores' }[status] || status);
}

function sourceIcon(type) { return type === 'rest' ? '↗' : '▤'; }

function showToast(message, error = false) {
  const toast = document.createElement('div');
  toast.className = `toast${error ? ' error' : ''}`;
  toast.textContent = message;
  $('#toast-region').appendChild(toast);
  setTimeout(() => toast.remove(), 4200);
}

function setConnection(status, text) {
  const node = $('#api-status');
  node.className = `connection-status ${status}`;
  node.innerHTML = `<i></i>${escapeHtml(text)}`;
}

async function refreshData() {
  try {
    const [stats, sources, collections, tags] = await Promise.all([
      api('/stats'), api('/sources'), api('/collections'), api('/tags')
    ]);
    state.stats = stats;
    state.sources = sources;
    state.collections = collections;
    state.tags = tags;
    setConnection('online', 'API local conectada');
    renderView();
  } catch (error) {
    setConnection('error', 'API no disponible');
    showToast(error.message, true);
  }
}

function renderView() {
  document.querySelectorAll('.view').forEach((view) => view.classList.toggle('active', view.id === `view-${state.view}`));
  document.querySelectorAll('.nav-item').forEach((item) => item.classList.toggle('active', item.dataset.view === state.view));
  $('#page-title').textContent = ({ dashboard: 'Inicio', search: 'Buscar', sources: 'Fuentes', collections: 'Colecciones', settings: 'Configuración' }[state.view]);
  if (state.view === 'dashboard') renderDashboard();
  if (state.view === 'search') renderSearch();
  if (state.view === 'sources') renderSources();
  if (state.view === 'collections') renderCollections();
  if (state.view === 'settings') renderSettings();
}

function renderDashboard() {
  const stats = state.stats || { documents: 0, sources: 0, collections: 0, recent: [] };
  const recent = (stats.recent || []).map((doc) => `
    <div class="doc-row document-hit" data-view-document="${escapeHtml(doc.id)}" tabindex="0" role="button" aria-label="Abrir ${escapeHtml(doc.title)}">
      <div class="doc-icon">${escapeHtml(typeLabel(doc.type))}</div>
      <div class="doc-main"><div class="doc-title">${escapeHtml(doc.title)}</div><div class="doc-meta">${escapeHtml(doc.source)} · ${escapeHtml(doc.path || 'Sin ruta')}</div></div>
      <div class="doc-date">${escapeHtml(shortDate(doc.updatedAt))}</div>
    </div>`).join('');
  const sources = state.sources.slice(0, 5).map((source) => `
    <div class="source-mini"><div class="source-logo">${sourceIcon(source.type)}</div><div><div class="source-name">${escapeHtml(source.name)}</div><div class="source-meta">${source.documentCount} documentos · ${escapeHtml(shortDate(source.lastSyncAt))}</div></div><span class="pill ${escapeHtml(source.status)}">${escapeHtml(statusLabel(source.status))}</span></div>`).join('');
  $('#view-dashboard').innerHTML = `
    <div class="hero"><div><h1>Workspace</h1><div class="hero-meta">${stats.documents} documentos · ${stats.sources} fuentes</div></div><div class="hero-action"><button class="btn btn-secondary" data-action="open-search">⌕ Buscar</button><button class="btn btn-primary" data-action="new-source">＋ Fuente</button></div></div>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-label">Documentos</div><div class="stat-value">${stats.documents}</div></div>
      <div class="stat-card"><div class="stat-label">Fuentes</div><div class="stat-value">${stats.sources}</div></div>
      <div class="stat-card"><div class="stat-label">Colecciones</div><div class="stat-value">${stats.collections}</div></div>
      <div class="stat-card"><div class="stat-label">Última sync</div><div class="stat-value stat-date">${escapeHtml(shortDate(stats.lastSyncAt))}</div></div>
    </div>
    <div class="dashboard-grid">
      <div class="panel"><div class="panel-header"><h2>Recientes</h2><button class="text-link" data-action="open-search">Ver todo →</button></div>${recent || '<div class="empty">Sin documentos</div>'}</div>
      <div class="panel"><div class="panel-header"><h2>Fuentes</h2><button class="text-link" data-action="open-sources">Gestionar →</button></div>${sources || '<div class="empty">Sin fuentes</div>'}</div>
    </div>`;
  bindActions($('#view-dashboard'));
  bindDocumentOpeners($('#view-dashboard'));
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

function cancelSearchDebounce() {
  if (searchDebounceTimer !== null) {
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = null;
  }
}

function scheduleSearch() {
  cancelSearchDebounce();
  searchDebounceTimer = setTimeout(() => {
    searchDebounceTimer = null;
    if (state.view === 'search') performSearch();
  }, SEARCH_DEBOUNCE_MS);
}

function renderSearch(results = null, { restoreFocus = false, selectionStart = null, selectionEnd = null } = {}) {
  const resultItems = results || [];
  const resultHtml = resultItems.length ? resultItems.map((doc) => `
    <article class="result-card document-hit" data-view-document="${escapeHtml(doc.id)}" tabindex="0" role="button" aria-label="Abrir ${escapeHtml(doc.title)}">
      <div class="result-head"><div class="doc-icon">${escapeHtml(typeLabel(doc.type))}</div><div class="result-title-wrap"><h3 class="result-title">${escapeHtml(doc.title)}</h3><div class="result-source">${escapeHtml(doc.source)} · ${escapeHtml(shortDate(doc.updatedAt))}</div></div><span class="score">${Math.round((doc.score || 0) * 100)}%</span></div>
      <div class="snippet">${escapeHtml(doc.snippet || doc.content?.slice(0, 220))}</div>
      <div class="result-foot">${(doc.tags || []).map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`).join('')}<span class="path" title="${escapeHtml(doc.path || '')}">↳ ${escapeHtml(doc.path || 'Sin ruta')}</span><div class="result-actions"><button class="btn btn-secondary btn-small" data-tag-document="${escapeHtml(doc.id)}">＋ Etiqueta</button><select class="select mini-select" data-add-collection="${escapeHtml(doc.id)}"><option value="">＋ Colección</option>${collectionOptions().replace('<option value="">Todas las colecciones</option>', '')}</select></div></div>
    </article>`).join('') : `<div class="empty">${state.searchQuery ? 'No hay coincidencias para esta consulta. Prueba otra palabra o ajusta los filtros.' : 'Escribe una consulta para buscar en tu conocimiento técnico.'}</div>`;
  $('#view-search').innerHTML = `
    <div class="section-top"><h1>Buscar</h1></div>
    <div class="panel"><div class="search-bar"><div class="search-input-wrap"><span>⌕</span><input id="search-input" class="search-input" value="${escapeHtml(state.searchQuery)}" placeholder="Buscar documentos…" autocomplete="off" /><button id="search-submit" class="btn btn-primary search-submit">Buscar</button></div></div><div class="filter-row"><select id="filter-source" class="select">${sourceOptions(state.filters.source)}</select><select id="filter-type" class="select"><option value="">Tipo</option><option value="markdown" ${state.filters.type === 'markdown' ? 'selected' : ''}>Markdown</option><option value="json" ${state.filters.type === 'json' ? 'selected' : ''}>JSON</option><option value="csv" ${state.filters.type === 'csv' ? 'selected' : ''}>CSV</option><option value="text" ${state.filters.type === 'text' ? 'selected' : ''}>TXT</option><option value="rest" ${state.filters.type === 'rest' ? 'selected' : ''}>REST</option></select><select id="filter-tag" class="select">${tagOptions(state.filters.tag).replace('Todas las etiquetas', 'Etiqueta')}</select><select id="filter-collection" class="select">${collectionOptions(state.filters.collection).replace('Todas las colecciones', 'Colección')}</select><label class="form-label date-filter">Desde<input id="filter-date" type="date" class="field" value="${escapeHtml(state.filters.date)}" /></label><button id="clear-filters" class="btn btn-secondary btn-small">Limpiar</button></div><div class="panel-header"><h2>${state.searchQuery ? `${resultItems.length} resultados` : 'Documentos'}</h2></div><div class="result-list">${resultHtml}</div></div>`;
  const input = $('#search-input');
  $('#search-submit').addEventListener('click', () => { cancelSearchDebounce(); performSearch(); });
  input.addEventListener('input', () => { searchRequestId += 1; scheduleSearch(); });
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') { cancelSearchDebounce(); performSearch(); } });
  ['filter-source', 'filter-type', 'filter-tag', 'filter-collection', 'filter-date'].forEach((id) => $(`#${id}`).addEventListener('change', () => { cancelSearchDebounce(); performSearch(); }));
  $('#clear-filters').addEventListener('click', () => { cancelSearchDebounce(); searchRequestId += 1; state.searchQuery = ''; state.filters = { source: '', type: '', tag: '', collection: '', date: '' }; renderSearch([]); });
  document.querySelectorAll('[data-add-collection]').forEach((select) => select.addEventListener('change', async () => {
    if (!select.value) return;
    try { await api(`/collections/${select.value}/items`, { method: 'POST', body: JSON.stringify({ documentId: select.dataset.addCollection }) }); showToast('Documento añadido a la colección'); } catch (error) { showToast(error.message, true); }
    select.value = '';
    await refreshData();
  }));
  document.querySelectorAll('[data-tag-document]').forEach((button) => button.addEventListener('click', async () => {
    const name = window.prompt('Nombre de la etiqueta');
    if (!name) return;
    try { await api(`/documents/${button.dataset.tagDocument}/tags`, { method: 'POST', body: JSON.stringify({ name }) }); showToast('Etiqueta guardada'); await refreshData(); } catch (error) { showToast(error.message, true); }
  }));
  bindDocumentOpeners($('#view-search'));
  if (restoreFocus) {
    input.focus();
    const start = Math.min(selectionStart ?? input.value.length, input.value.length);
    const end = Math.min(selectionEnd ?? start, input.value.length);
    input.setSelectionRange(start, end);
  }
}

function bindDocumentOpeners(container) {
  container.querySelectorAll('[data-view-document]').forEach((card) => {
    const open = (event) => {
      if (event.target.closest('button, select, input, textarea, a')) return;
      openDocument(card.dataset.viewDocument);
    };
    card.addEventListener('click', open);
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openDocument(card.dataset.viewDocument);
      }
    });
  });
}

function documentContent(doc) {
  if (doc.type === 'json') {
    try { return JSON.stringify(JSON.parse(doc.content), null, 2); } catch { return doc.content; }
  }
  return doc.content || 'Documento vacío';
}

async function openDocument(id) {
  try {
    const doc = await api(`/documents/${encodeURIComponent(id)}`);
    const tags = doc.tags?.length ? doc.tags.map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`).join('') : '<span class="viewer-muted">Sin etiquetas</span>';
    $('#modal-root').innerHTML = `<div class="modal-backdrop"><div class="modal viewer-modal"><div class="modal-head"><div class="viewer-title-wrap"><input id="document-title" class="viewer-title" value="${escapeHtml(doc.title)}" aria-label="Título del documento" /><div class="viewer-subtitle">${escapeHtml(typeLabel(doc.type))} · ${escapeHtml(doc.source)}</div></div><button class="modal-close" data-close-modal>×</button></div><div class="viewer-body"><div class="viewer-meta"><span title="${escapeHtml(doc.path || '')}">↳ ${escapeHtml(doc.path || 'Sin ruta')}</span><span>${escapeHtml(shortDate(doc.updatedAt))}</span><div class="viewer-tags">${tags}</div></div><textarea id="document-content" class="document-content" aria-label="Contenido del documento" spellcheck="false">${escapeHtml(documentContent(doc))}</textarea></div><div class="modal-actions"><button class="btn btn-secondary" id="copy-document">Copiar</button><button class="btn btn-primary" id="save-document">Guardar cambios</button><button class="btn btn-secondary" data-close-modal>Cerrar</button></div></div></div>`;
    window.document.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', closeModal));
    $('#copy-document').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText($('#document-content').value); showToast('Contenido copiado'); } catch { showToast('No se pudo copiar', true); }
    });
    $('#save-document').addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = 'Guardando…';
      try {
        await api(`/documents/${encodeURIComponent(doc.id)}`, { method: 'PUT', body: JSON.stringify({ title: $('#document-title').value, content: $('#document-content').value }) });
        showToast('Cambios guardados');
        await refreshData();
      } catch (error) {
        showToast(error.message, true);
      } finally {
        button.disabled = false;
        button.textContent = 'Guardar cambios';
      }
    });
  } catch (error) {
    showToast(error.message, true);
  }
}

async function performSearch() {
  const input = $('#search-input');
  if (!input) return;
  const restoreFocus = document.activeElement === input;
  const selectionStart = input.selectionStart;
  const selectionEnd = input.selectionEnd;
  state.searchQuery = input.value.trim();
  const requestId = ++searchRequestId;
  const params = new URLSearchParams({ q: state.searchQuery });
  [['filter-source', 'source'], ['filter-type', 'type'], ['filter-tag', 'tag'], ['filter-collection', 'collection'], ['filter-date', 'updatedFrom']].forEach(([id, key]) => { const stateKey = key === 'updatedFrom' ? 'date' : key; const value = $(`#${id}`)?.value || ''; state.filters[stateKey] = value; if (value) params.set(key, value); });
  try { const response = await api(`/search?${params}`); if (requestId === searchRequestId && state.view === 'search') renderSearch(response.results, { restoreFocus, selectionStart, selectionEnd }); } catch (error) { if (requestId === searchRequestId && state.view === 'search') showToast(error.message, true); }
}

function renderSources() {
  const offline = state.user?.offline === true;
  const cards = state.sources.map((source) => {
    const config = source.config || {};
    const detail = source.type === 'rest' ? config.url : (config.paths || []).join(' · ');
    return `<article class="source-card"><div class="source-card-top"><div class="source-logo">${sourceIcon(source.type)}</div><div class="source-details"><h3>${escapeHtml(source.name)}</h3><div class="source-url">${escapeHtml(detail || 'Sin configuración')}</div></div><span class="pill ${escapeHtml(source.status)}">${escapeHtml(statusLabel(source.status))}</span></div><div class="source-actions"><button class="btn btn-secondary btn-small" data-source-test="${escapeHtml(source.id)}">Probar</button><button class="btn btn-secondary btn-small" data-source-sync="${escapeHtml(source.id)}">↻ Sync</button><button class="btn btn-secondary btn-small" data-source-edit="${escapeHtml(source.id)}">Editar</button><button class="btn btn-danger btn-small" data-source-delete="${escapeHtml(source.id)}">Eliminar</button><span class="source-info">${source.documentCount} docs · ${escapeHtml(shortDate(source.lastSyncAt))}</span></div>${source.lastError ? `<p class="form-note" style="color:var(--red);margin-top:11px">${escapeHtml(source.lastError)}</p>` : ''}</article>`;
  }).join('');
  const offlineNote = offline ? '<p class="offline-note">Modo offline: solo se muestran y sincronizan archivos locales de este equipo.</p>' : '';
  const actions = offline ? '<button class="btn btn-primary" data-action="new-local">＋ Local</button>' : '<button class="btn btn-secondary" data-action="new-rest">＋ API</button><button class="btn btn-primary" data-action="new-local">＋ Local</button>';
  $('#view-sources').innerHTML = `<div class="section-top"><div><h1>Fuentes</h1>${offlineNote}</div><div class="hero-action">${actions}</div></div><div class="source-list">${cards || '<div class="empty">Sin fuentes</div>'}</div>`;
  bindActions($('#view-sources'));
  document.querySelectorAll('[data-source-test]').forEach((button) => button.addEventListener('click', () => testSource(button.dataset.sourceTest)));
  document.querySelectorAll('[data-source-sync]').forEach((button) => button.addEventListener('click', () => syncSource(button.dataset.sourceSync)));
  document.querySelectorAll('[data-source-edit]').forEach((button) => button.addEventListener('click', () => openSourceModal(state.sources.find((source) => source.id === button.dataset.sourceEdit))));
  document.querySelectorAll('[data-source-delete]').forEach((button) => button.addEventListener('click', () => deleteSource(button.dataset.sourceDelete)));
}

function renderCollections() {
  if (state.selectedCollection) return renderCollectionDetail(state.selectedCollection);
  const cards = state.collections.map((collection) => `<article class="collection-card"><h3>${escapeHtml(collection.name)}</h3><p>${escapeHtml(collection.description || 'Sin descripción. Organiza aquí un contexto de trabajo.')}</p><div class="collection-bottom"><span>${collection.itemCount} documentos</span><button class="text-link" data-open-collection="${escapeHtml(collection.id)}">Abrir →</button></div></article>`).join('');
  $('#view-collections').innerHTML = `<div class="section-top"><h1>Colecciones</h1><button class="btn btn-primary" data-action="new-collection">＋ Nueva</button></div><div class="collection-grid">${cards || '<div class="empty">Sin colecciones</div>'}</div>`;
  bindActions($('#view-collections'));
  document.querySelectorAll('[data-open-collection]').forEach((button) => button.addEventListener('click', () => { state.selectedCollection = button.dataset.openCollection; renderCollections(); }));
}

async function renderCollectionDetail(id) {
  $('#view-collections').innerHTML = '<div class="empty">Cargando colección…</div>';
  try {
    const collection = await api(`/collections/${id}`);
    const docs = collection.items.map((doc) => `<div class="doc-row document-hit" data-view-document="${escapeHtml(doc.id)}" tabindex="0" role="button" aria-label="Abrir ${escapeHtml(doc.title)}"><div class="doc-icon">${escapeHtml(typeLabel(doc.type))}</div><div class="doc-main"><div class="doc-title">${escapeHtml(doc.title)}</div><div class="doc-meta">${escapeHtml(doc.source)} · ${escapeHtml(doc.path || 'Sin ruta')}</div></div><button class="btn btn-danger btn-small" data-remove-item="${escapeHtml(doc.id)}">Quitar</button></div>`).join('');
    $('#view-collections').innerHTML = `<div class="section-top"><div><button class="text-link" id="back-collections">← Colecciones</button><h1>${escapeHtml(collection.name)}</h1></div><span class="count-label">${collection.itemCount} docs</span></div><div class="panel collection-detail">${docs || '<div class="empty">Sin documentos</div>'}</div>`;
    $('#back-collections').addEventListener('click', () => { state.selectedCollection = null; renderCollections(); });
    document.querySelectorAll('[data-remove-item]').forEach((button) => button.addEventListener('click', async () => { try { await api(`/collections/${id}/items/${button.dataset.removeItem}`, { method: 'DELETE' }); showToast('Documento retirado'); await refreshData(); } catch (error) { showToast(error.message, true); } }));
    bindDocumentOpeners($('#view-collections'));
  } catch (error) { showToast(error.message, true); state.selectedCollection = null; renderCollections(); }
}

function renderSettings() {
  $('#view-settings').innerHTML = `<div class="section-top"><h1>Configuración</h1></div><div class="settings-grid"><div class="panel"><div class="panel-header"><h2>Componentes</h2></div><div class="setting-row"><div class="setting-label">Electron</div><span class="check">Activo</span></div><div class="setting-row"><div class="setting-label">Express</div><span class="check">Activo</span></div><div class="setting-row"><div class="setting-label">SQLite</div><span class="check">Activo</span></div><div class="setting-row"><div class="setting-label">Fuse.js</div><span class="check">Activo</span></div></div><div class="panel"><div class="panel-header"><h2>Seguridad</h2></div><div class="setting-row"><div class="setting-label">Node integration</div><span class="check">Off</span></div><div class="setting-row"><div class="setting-label">Context isolation</div><span class="check">On</span></div><div class="setting-row"><div class="setting-label">Servidor</div><span class="setting-value">127.0.0.1</span></div><div class="setting-row"><div class="setting-label">Credenciales</div><span class="setting-value">Ocultas</span></div></div></div>`;
}

function bindActions(container) {
  container.querySelectorAll('[data-action]').forEach((button) => button.addEventListener('click', () => {
    const action = button.dataset.action;
    if (action === 'open-search') { state.view = 'search'; state.searchQuery = ''; renderView(); }
    if (action === 'open-sources') { state.view = 'sources'; renderView(); }
    if (action === 'new-source' || action === 'new-local') openSourceModal(null, 'local');
    if (action === 'new-rest') openSourceModal(null, 'rest');
    if (action === 'new-collection') openCollectionModal();
  }));
}

async function testSource(id) {
  try { const result = await api(`/sources/${id}/test`, { method: 'POST' }); showToast(result.ok ? 'Conexión correcta' : 'La fuente no está accesible', !result.ok); } catch (error) { showToast(error.message, true); }
  await refreshData();
}

async function syncSource(id) {
  const source = state.sources.find((item) => item.id === id);
  try { const result = await api(`/sources/${id}/sync`, { method: 'POST' }); showToast(`${result.total || 0} documentos sincronizados desde ${source?.name || 'la fuente'}`); } catch (error) { showToast(error.message, true); }
  await refreshData();
}

async function deleteSource(id) {
  const source = state.sources.find((item) => item.id === id);
  if (!window.confirm(`¿Eliminar la fuente “${source?.name || ''}” y sus documentos?`)) return;
  try { await api(`/sources/${id}`, { method: 'DELETE' }); showToast('Fuente eliminada'); await refreshData(); } catch (error) { showToast(error.message, true); }
}

function openSourceModal(existing = null, forcedType = null) {
  const offline = state.user?.offline === true;
  const type = offline ? 'local' : (forcedType || existing?.type || 'local');
  const config = existing?.config || {};
  const paths = [...(config.paths || [])];
  const headerObject = config.headers || {};
  const typeOptions = offline ? '<option value="local">Archivos locales</option>' : `<option value="local" ${type === 'local' ? 'selected' : ''}>Archivos locales</option><option value="rest" ${type === 'rest' ? 'selected' : ''}>API REST</option>`;
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><div class="modal"><div class="modal-head"><h2>${existing ? 'Editar fuente' : 'Añadir fuente'}</h2><button class="modal-close" data-close-modal>×</button></div><div class="modal-body"><div class="form-grid"><label class="form-label">Nombre<input id="source-name" class="field" value="${escapeHtml(existing?.name || '')}" placeholder="Ej. Proyecto Alpha" /></label><div class="form-grid two"><label class="form-label">Tipo<select id="source-type" class="select">${typeOptions}</select></label><div></div></div><div id="source-config"></div></div></div><div class="modal-actions"><button class="btn btn-secondary" data-close-modal>Cancelar</button><button id="save-source" class="btn btn-primary">${existing ? 'Guardar cambios' : 'Añadir fuente'}</button></div></div></div>`;
  const renderConfig = (selectedType) => {
    $('#source-config').innerHTML = selectedType === 'local' ? `<div class="form-grid"><div class="form-label">Archivos y carpetas<div class="selection-box" id="path-selection">${paths.length ? paths.map((item) => `<span class="selection-chip"><span>${escapeHtml(item)}</span></span>`).join('') : '<span class="form-note">Selecciona archivos o una carpeta.</span>'}</div><div style="display:flex;gap:8px;margin-top:8px"><button class="btn btn-secondary btn-small" id="choose-files">Archivos</button><button class="btn btn-secondary btn-small" id="choose-folder">Carpeta</button></div></div><p class="form-note">JSON · CSV · TXT · Markdown</p></div>` : `<div class="form-grid"><label class="form-label">URL<input id="rest-url" class="field" value="${escapeHtml(config.url || '')}" placeholder="https://api.example.com/issues" /></label><label class="form-label">Cabeceras JSON<textarea id="rest-headers" class="textarea" placeholder='{"Authorization":"Bearer TOKEN"}'>${escapeHtml(JSON.stringify(headerObject, null, 2))}</textarea></label><p class="form-note">Las cabeceras se ocultan en la lista.</p><div class="form-grid two"><label class="form-label">ID<input id="map-id" class="field" value="${escapeHtml(config.mapping?.id || 'id')}" /></label><label class="form-label">Título<input id="map-title" class="field" value="${escapeHtml(config.mapping?.title || 'title')}" /></label></div><label class="form-label">Contenido<input id="map-content" class="field" value="${escapeHtml(config.mapping?.content || 'description')}" /></label></div>`;
    if (selectedType === 'local') {
      $('#choose-files').addEventListener('click', async () => { const selected = await window.nexusData.selectLocalPaths({ directory: false }); paths.push(...selected); renderConfig('local'); });
      $('#choose-folder').addEventListener('click', async () => { const selected = await window.nexusData.selectLocalPaths({ directory: true }); paths.push(...selected); renderConfig('local'); });
    }
  };
  renderConfig(type);
  $('#source-type').addEventListener('change', (event) => renderConfig(event.target.value));
  document.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', closeModal));
  $('#save-source').addEventListener('click', async () => {
    try {
      const selectedType = $('#source-type').value;
      const body = { name: $('#source-name').value.trim(), type: selectedType, config: selectedType === 'local' ? { paths: [...new Set(paths)] } : (() => {
        let headers = {};
        try { headers = $('#rest-headers').value.trim() ? JSON.parse($('#rest-headers').value) : {}; } catch { throw new Error('Las cabeceras no son JSON válido'); }
        return { url: $('#rest-url').value.trim(), headers, mapping: { id: $('#map-id').value.trim(), title: $('#map-title').value.trim(), content: $('#map-content').value.trim() } };
      })() };
      const saved = await api(existing ? `/sources/${existing.id}` : '/sources', { method: existing ? 'PUT' : 'POST', body: JSON.stringify(body) });
      closeModal();
      state.view = 'sources';
      await refreshData();
      if (!existing) await syncSource(saved.id);
      else showToast('Fuente actualizada');
    } catch (error) { showToast(error.message, true); }
  });
}

function openCollectionModal() {
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><div class="modal"><div class="modal-head"><h2>Nueva colección</h2><button class="modal-close" data-close-modal>×</button></div><div class="modal-body"><div class="form-grid"><label class="form-label">Nombre<input id="collection-name" class="field" placeholder="Proyecto Alpha" /></label><label class="form-label">Descripción<textarea id="collection-description" class="textarea" placeholder="Opcional"></textarea></label></div></div><div class="modal-actions"><button class="btn btn-secondary" data-close-modal>Cancelar</button><button id="save-collection" class="btn btn-primary">Crear</button></div></div></div>`;
  document.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', closeModal));
  $('#save-collection').addEventListener('click', async () => { try { await api('/collections', { method: 'POST', body: JSON.stringify({ name: $('#collection-name').value, description: $('#collection-description').value }) }); closeModal(); showToast('Colección creada'); await refreshData(); } catch (error) { showToast(error.message, true); } });
}

function closeModal() { $('#modal-root').innerHTML = ''; }

document.querySelectorAll('.nav-item').forEach((button) => button.addEventListener('click', () => { state.view = button.dataset.view; state.selectedCollection = null; renderView(); if (state.view === 'search') performSearch(); }));

$('#logout-button').addEventListener('click', async () => {
  try { await api('/auth/logout', { method: 'POST' }); } catch { /* La vista se cierra aunque el servidor ya no esté disponible. */ }
  showAuthentication();
});

initialiseSession();
