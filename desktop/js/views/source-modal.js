import { $, escapeHtml } from '../core/dom.js';
import { api } from '../core/api.js';
import { OFFLINE_ONLY, state } from '../core/state.js';
import { showToast } from '../ui/notifications.js';
import { closeModal, bindModalClose } from '../ui/modals.js';

let refreshData = async () => {};
let syncSource = async () => {};

export function configureSourceModal({ onRefresh, onSync } = {}) {
  refreshData = onRefresh || refreshData;
  syncSource = onSync || syncSource;
}

export function openSourceModal(existing = null, forcedType = null, initialPaths = [], initialName = '', returnView = 'sources') {
  const offline = OFFLINE_ONLY || state.user?.offline === true;
  const type = offline ? 'local' : (forcedType || existing?.type || 'local');
  const config = existing?.config || {};
  const paths = [...(initialPaths.length ? initialPaths : (config.paths || []))];
  const headerObject = config.headers || {};
  const typeOptions = offline ? '<option value="local">Archivos locales</option>' : `<option value="local" ${type === 'local' ? 'selected' : ''}>Archivos locales</option><option value="rest" ${type === 'rest' ? 'selected' : ''}>API REST</option>`;
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true"><div class="modal-head"><h2>${existing ? 'Editar fuente' : 'Añadir fuente'}</h2><button class="modal-close" data-close-modal aria-label="Cerrar">×</button></div><div class="modal-body"><div class="form-grid"><label class="form-label">Nombre<input id="source-name" class="field" value="${escapeHtml(existing?.name || initialName || '')}" placeholder="Ej. Proyecto Alpha" /></label><div class="form-grid two"><label class="form-label">Tipo<select id="source-type" class="select">${typeOptions}</select></label><div></div></div><div id="source-config"></div></div></div><div class="modal-actions"><button class="btn btn-secondary" data-close-modal>Cancelar</button><button id="save-source" class="btn btn-primary">${existing ? 'Guardar cambios' : 'Añadir fuente'}</button></div></div></div>`;
  const renderConfig = (selectedType) => {
    $('#source-config').innerHTML = selectedType === 'local'
      ? `<div class="form-grid"><div class="form-label">Archivos y carpetas<div class="selection-box" id="path-selection">${paths.length ? paths.map((item) => `<span class="selection-chip"><span>${escapeHtml(item)}</span></span>`).join('') : '<span class="form-note">Sin archivos</span>'}</div><div class="modal-inline-actions"><button class="btn btn-secondary btn-small" id="choose-files">Archivos</button><button class="btn btn-secondary btn-small" id="choose-folder">Carpeta</button></div></div></div>`
      : `<div class="form-grid"><label class="form-label">URL<input id="rest-url" class="field" value="${escapeHtml(config.url || '')}" placeholder="https://api.example.com/issues" /></label><label class="form-label">Cabeceras JSON<textarea id="rest-headers" class="textarea" placeholder='{"Authorization":"Bearer TOKEN"}'>${escapeHtml(JSON.stringify(headerObject, null, 2))}</textarea></label><div class="form-grid two"><label class="form-label">ID<input id="map-id" class="field" value="${escapeHtml(config.mapping?.id || 'id')}" /></label><label class="form-label">Título<input id="map-title" class="field" value="${escapeHtml(config.mapping?.title || 'title')}" /></label></div><label class="form-label">Contenido<input id="map-content" class="field" value="${escapeHtml(config.mapping?.content || 'description')}" /></label></div>`;
    if (selectedType === 'local') {
      $('#choose-files').addEventListener('click', async () => { const selected = await window.nexusData.selectLocalPaths({ directory: false }); paths.push(...selected); renderConfig('local'); });
      $('#choose-folder').addEventListener('click', async () => { const selected = await window.nexusData.selectLocalPaths({ directory: true }); paths.push(...selected); renderConfig('local'); });
    }
  };
  renderConfig(type);
  $('#source-type').addEventListener('change', (event) => renderConfig(event.target.value));
  bindModalClose();
  $('#save-source').addEventListener('click', async () => {
    try {
      const selectedType = $('#source-type').value;
      const body = {
        name: $('#source-name').value.trim(),
        type: selectedType,
        config: selectedType === 'local' ? { paths: [...new Set(paths)], ...(config.role ? { role: config.role } : {}) } : (() => {
          let headers = {};
          try { headers = $('#rest-headers').value.trim() ? JSON.parse($('#rest-headers').value) : {}; } catch { throw new Error('Las cabeceras no son JSON válido'); }
          return { url: $('#rest-url').value.trim(), headers, mapping: { id: $('#map-id').value.trim(), title: $('#map-title').value.trim(), content: $('#map-content').value.trim() } };
        })()
      };
      const saved = await api(existing ? `/sources/${existing.id}` : '/sources', { method: existing ? 'PUT' : 'POST', body: JSON.stringify(body) });
      closeModal();
      state.view = returnView;
      await refreshData();
      if (!existing) await syncSource(saved.id);
      else showToast('Fuente actualizada');
    } catch (error) { showToast(error.message, true); }
  });
}
