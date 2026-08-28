import { $, escapeHtml } from '../core/dom.js';
import { api } from '../core/api.js';
import { OFFLINE_ONLY, state } from '../core/state.js';
import { shortDate, sourceIcon, statusLabel } from '../core/format.js';
import { sectionIconMarkup } from '../core/section-icons.js';
import { showToast } from '../ui/notifications.js';
import { openSourceModal } from './source-modal.js';

let refreshData = async () => {};

export function configureSources({ onRefresh } = {}) {
  refreshData = onRefresh || refreshData;
}

export async function testSource(id) {
  try { const result = await api(`/sources/${id}/test`, { method: 'POST' }); showToast(result.ok ? 'Conexión correcta' : 'La fuente no está accesible', !result.ok); } catch (error) { showToast(error.message, true); }
  await refreshData();
}

export async function syncSource(id) {
  const source = state.sources.find((item) => item.id === id);
  try { const result = await api(`/sources/${id}/sync`, { method: 'POST' }); showToast(`${result.total || 0} documentos sincronizados desde ${source?.name || 'la fuente'}`); } catch (error) { showToast(error.message, true); }
  await refreshData();
}

export async function deleteSource(id) {
  const source = state.sources.find((item) => item.id === id);
  if (!window.confirm(`¿Eliminar la fuente “${source?.name || ''}” y sus documentos?`)) return;
  try { await api(`/sources/${id}`, { method: 'DELETE' }); showToast('Fuente eliminada'); await refreshData(); } catch (error) { showToast(error.message, true); }
}

function bindActionButtons(container, selector, action) {
  container.querySelectorAll(selector).forEach((button) => button.addEventListener('click', () => action(button)));
}

export function renderSources() {
  const offline = OFFLINE_ONLY || state.user?.offline === true;
  const visibleSources = offline ? state.sources.filter((source) => source.type === 'local') : state.sources;
  const cards = visibleSources.map((source) => {
    const config = source.config || {};
    const detail = source.type === 'rest' ? config.url : (config.paths || []).join(' · ');
    const sourceKind = source.type === 'rest' ? 'rest' : source.type === 'local' ? 'local' : 'generic';
    const sourceLabel = sourceKind === 'rest' ? 'API REST' : sourceKind === 'local' ? 'Archivos locales' : 'Fuente';
    return `<article class="source-card"><div class="source-card-top"><div class="source-logo source-logo-${sourceKind}" role="img" aria-label="${sourceLabel}" title="${sourceLabel}">${sourceIcon(sourceKind)}</div><div class="source-details"><h3>${escapeHtml(source.name)}</h3><div class="source-url">${escapeHtml(detail || 'Sin configuración')}</div></div><span class="pill ${escapeHtml(source.status)}">${escapeHtml(statusLabel(source.status))}</span></div><div class="source-actions"><button class="btn btn-secondary btn-small" data-source-test="${escapeHtml(source.id)}">Probar</button><button class="btn btn-secondary btn-small" data-source-sync="${escapeHtml(source.id)}">↻ Sync</button><button class="btn btn-secondary btn-small" data-source-edit="${escapeHtml(source.id)}">Editar</button><button class="btn btn-danger btn-small" data-source-delete="${escapeHtml(source.id)}">Eliminar</button><span class="source-info">${source.documentCount} docs · ${escapeHtml(shortDate(source.lastSyncAt))}</span></div>${source.lastError ? `<p class="form-note source-error">${escapeHtml(source.lastError)}</p>` : ''}</article>`;
  }).join('');
  const actions = offline ? '<button class="btn btn-primary" data-action="new-local">＋ Local</button>' : '<button class="btn btn-secondary" data-action="new-rest">＋ API</button><button class="btn btn-primary" data-action="new-local">＋ Local</button>';
  $('#view-sources').innerHTML = `<div class="section-top"><div class="section-heading-with-icon">${sectionIconMarkup('sources')}<h1>Fuentes</h1></div><div class="hero-action">${actions}</div></div><div class="source-list">${cards || '<div class="empty">Sin fuentes</div>'}</div>`;
  $('#view-sources').querySelectorAll('[data-action="new-local"]').forEach((button) => button.addEventListener('click', () => openSourceModal(null, 'local')));
  $('#view-sources').querySelectorAll('[data-action="new-rest"]').forEach((button) => button.addEventListener('click', () => openSourceModal(null, 'rest')));
  bindActionButtons($('#view-sources'), '[data-source-test]', (button) => testSource(button.dataset.sourceTest));
  bindActionButtons($('#view-sources'), '[data-source-sync]', (button) => syncSource(button.dataset.sourceSync));
  bindActionButtons($('#view-sources'), '[data-source-edit]', (button) => openSourceModal(state.sources.find((source) => source.id === button.dataset.sourceEdit)));
  bindActionButtons($('#view-sources'), '[data-source-delete]', (button) => deleteSource(button.dataset.sourceDelete));
}
