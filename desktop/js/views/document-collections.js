import { $, escapeHtml } from '../core/dom.js';
import { api } from '../core/api.js';
import { shortDate, typeLabel } from '../core/format.js';
import { sectionIconMarkup } from '../core/section-icons.js';
import { bindCopyPathActions, bindDocumentFavoriteActions, bindDocumentOpeners, copyPathButtonMarkup, favoriteButtonMarkup } from './documents.js';

let collectionRequestId = 0;
let favoriteSearchTerm = '';

const COLLECTIONS = Object.freeze({
  recent: {
    viewId: 'view-recent-documents',
    endpoint: '/documents/recent',
    title: 'Documentos recientes',
    panelTitle: 'Últimos documentos',
    emptyTitle: 'Aún no hay documentos recientes',
    emptyDescription: 'Los documentos sincronizados o editados aparecerán aquí.'
  },
  favorites: {
    viewId: 'view-favorites',
    endpoint: '/documents/favorites?limit=500',
    title: 'Favoritos',
    searchable: true,
    panelTitle: 'Tus favoritos',
    emptyTitle: 'Todavía no tienes favoritos',
    emptyDescription: 'Marca un documento con la estrella para verlo en esta sección.'
  }
});

function compactContent(content) {
  return String(content || '').replace(/\s+/g, ' ').trim().slice(0, 220);
}

function normaliseSearchText(value) {
  return String(value || '').toLocaleLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function documentCard(doc) {
  const title = doc.title || 'Sin título';
  const source = doc.source || 'Fuente desconocida';
  const path = doc.path || 'Sin ruta';
  const content = doc.metadata?.contentDeferred ? 'Contenido disponible al abrir' : compactContent(doc.content);
  const tags = (doc.tags || []).map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`).join('');
  const searchText = [title, source, path, content, typeLabel(doc.type), ...(doc.tags || [])].join(' ');
  return `<article class="result-card document-hit document-collection-card" data-view-document="${escapeHtml(doc.id)}" data-document-search="${escapeHtml(searchText)}" tabindex="0" role="button" aria-label="Abrir ${escapeHtml(title)}">
    <div class="result-head">
      <div class="doc-icon">${escapeHtml(typeLabel(doc.type))}</div>
      <div class="result-title-wrap"><h3 class="result-title">${escapeHtml(title)}</h3><div class="result-source" title="${escapeHtml(path)}">${escapeHtml(source)} · ${escapeHtml(path)}</div></div>
      <span class="document-collection-date">${escapeHtml(shortDate(doc.updatedAt))}</span>
    </div>
    <div class="snippet">${escapeHtml(content || 'Documento vacío')}</div>
    <div class="result-foot"><div class="document-collection-tags">${tags}</div><div class="result-actions">${favoriteButtonMarkup(doc)}${copyPathButtonMarkup(doc.path)}</div></div>
  </article>`;
}

function documentListMarkup(documents, config) {
  if (!documents.length) {
    return `<div class="document-collection-empty"><strong>${escapeHtml(config.emptyTitle)}</strong><span>${escapeHtml(config.emptyDescription)}</span></div>`;
  }
  return documents.map(documentCard).join('');
}

function collectionSearchMarkup(config, documents) {
  if (!config.searchable || !Array.isArray(documents)) return '';
  return `<label class="document-collection-search"><span aria-hidden="true">⌕</span><input id="favorites-search" class="document-collection-search-input" type="search" value="${escapeHtml(favoriteSearchTerm)}" placeholder="Buscar favoritos…" autocomplete="off" aria-label="Buscar en favoritos" /></label>`;
}

function favoriteSearchEmptyMarkup(config, documents) {
  if (!config.searchable || !documents.length) return '';
  return '<div id="favorites-search-empty" class="document-collection-filter-empty" hidden><strong>No hay favoritos que coincidan</strong><span>Prueba con otro título, ruta o palabra.</span></div>';
}

function viewMarkup(config, documents = null, error = null) {
  const body = error
    ? `<div class="document-collection-error"><strong>No se pudo cargar esta vista</strong><span>${escapeHtml(error.message || 'Error desconocido')}</span></div>`
      : documents === null
        ? '<div class="document-collection-loading">Cargando documentos…</div>'
        : documentListMarkup(documents, config);
  const description = config.description ? `<p class="lead">${escapeHtml(config.description)}</p>` : '';
  const compactClass = ['view-recent-documents', 'view-favorites'].includes(config.viewId) ? ' document-collection-compact' : '';
  const searchEmpty = Array.isArray(documents) ? favoriteSearchEmptyMarkup(config, documents) : '';
  const sectionIcon = config.viewId === 'view-favorites' ? 'favorite' : 'recent';
  return `<div class="document-collection-shell${compactClass}"><div class="section-top"><div class="section-heading-with-icon">${sectionIconMarkup(sectionIcon)}<div class="section-heading-copy"><h1>${escapeHtml(config.title)}</h1>${description}</div></div></div><div class="panel search-results-panel document-collection-panel"><div class="panel-header"><h2>${escapeHtml(config.panelTitle)}</h2>${collectionSearchMarkup(config, documents)}</div><div class="result-list">${body}${searchEmpty}</div></div></div>`;
}

function applyFavoriteSearch(container) {
  const input = $('#favorites-search', container);
  const term = normaliseSearchText(favoriteSearchTerm.trim());
  const cards = [...container.querySelectorAll('.document-collection-card')];
  cards.forEach((card) => {
    const matches = !term || normaliseSearchText(card.dataset.documentSearch || card.textContent).includes(term);
    card.hidden = !matches;
  });
  if (input && input.value !== favoriteSearchTerm) input.value = favoriteSearchTerm;
  const empty = $('#favorites-search-empty', container);
  if (empty) empty.hidden = !term || visible > 0;
}

function bindFavoriteSearch(container) {
  const input = $('#favorites-search', container);
  if (!input) return;
  input.addEventListener('input', () => {
    favoriteSearchTerm = input.value;
    applyFavoriteSearch(container);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !input.value) return;
    input.value = '';
    favoriteSearchTerm = '';
    applyFavoriteSearch(container);
  });
  applyFavoriteSearch(container);
}

async function renderCollection(config) {
  const container = $(`#${config.viewId}`);
  if (!container) return;
  const requestId = ++collectionRequestId;
  container.innerHTML = viewMarkup(config);
  try {
    const response = await api(config.endpoint);
    if (requestId !== collectionRequestId || !container.classList.contains('active')) return;
    const documents = Array.isArray(response.documents) ? response.documents : [];
    container.innerHTML = viewMarkup(config, documents);
    bindFavoriteSearch(container);
    bindCopyPathActions(container);
    bindDocumentFavoriteActions(container);
    bindDocumentOpeners(container);
  } catch (error) {
    if (requestId !== collectionRequestId || !container.classList.contains('active')) return;
    container.innerHTML = viewMarkup(config, null, error);
  }
}

export function renderRecentDocuments() {
  return renderCollection(COLLECTIONS.recent);
}

export function renderFavorites() {
  return renderCollection(COLLECTIONS.favorites);
}
