import { $, escapeHtml } from './dom.js';
import { api } from './api.js';
import {
  getSearchPreferences,
  persistSearchPreferences,
  persistSidebarSearchPreference,
  restoreSearchPreferences,
  state
} from './state.js';
import { currentPalette, savePalettePreference } from './theme.js';
import { getDiagramWorkspaceState, restoreDiagramWorkspaceState } from '../views/diagrams.js';
import { bindModalClose, closeModal } from '../ui/modals.js';
import { showToast } from '../ui/notifications.js';

const CLIENT_WORKSPACE_VERSION = 1;

let refreshData = async () => {};

export function configureWorkspace({ onRefresh } = {}) {
  refreshData = onRefresh || refreshData;
}

function cloneValue(value, fallback = null) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function codeMapWorkspaceState() {
  const codeMap = state.codeMap || {};
  return {
    sourceId: typeof codeMap.sourceId === 'string' ? codeMap.sourceId : null,
    scope: typeof codeMap.scope === 'string' ? codeMap.scope : 'project',
    entryFile: typeof codeMap.entryFile === 'string' ? codeMap.entryFile : '',
    entryFolder: typeof codeMap.entryFolder === 'string' ? codeMap.entryFolder : '',
    includeExternalPackages: codeMap.includeExternalPackages === true,
    excludes: Array.isArray(codeMap.excludes) ? codeMap.excludes.filter((value) => typeof value === 'string').slice(0, 100) : [],
    maxFiles: Number.isFinite(Number(codeMap.maxFiles)) ? Number(codeMap.maxFiles) : 2000,
    maxFileBytes: Number.isFinite(Number(codeMap.maxFileBytes)) ? Number(codeMap.maxFileBytes) : 2 * 1024 * 1024,
    filters: cloneValue(codeMap.filters, { query: '', language: '', symbolKind: '', relationKind: '' }),
    groupByFolder: codeMap.groupByFolder !== false,
    depth: typeof codeMap.depth === 'string' ? codeMap.depth : 'files',
    zoom: Number.isFinite(Number(codeMap.zoom)) ? Number(codeMap.zoom) : 1
  };
}

export function getClientWorkspaceState() {
  return {
    version: CLIENT_WORKSPACE_VERSION,
    palette: currentPalette(),
    searchPreferences: getSearchPreferences(),
    sidebarSearchExpanded: state.sidebarSearchExpanded === true,
    diagrams: getDiagramWorkspaceState(),
    codeMap: codeMapWorkspaceState()
  };
}

function restoreCodeMapWorkspaceState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !state.codeMap) return;
  const codeMap = state.codeMap;
  if (typeof value.sourceId === 'string' || value.sourceId === null) codeMap.sourceId = value.sourceId;
  if (typeof value.scope === 'string') codeMap.scope = value.scope;
  if (typeof value.entryFile === 'string') codeMap.entryFile = value.entryFile;
  if (typeof value.entryFolder === 'string') codeMap.entryFolder = value.entryFolder;
  if (typeof value.includeExternalPackages === 'boolean') codeMap.includeExternalPackages = value.includeExternalPackages;
  if (Array.isArray(value.excludes)) codeMap.excludes = value.excludes.filter((item) => typeof item === 'string').slice(0, 100);
  if (Number.isFinite(Number(value.maxFiles))) codeMap.maxFiles = Math.max(1, Math.min(2000, Number(value.maxFiles)));
  if (Number.isFinite(Number(value.maxFileBytes))) codeMap.maxFileBytes = Math.max(1, Math.min(20 * 1024 * 1024, Number(value.maxFileBytes)));
  if (value.filters && typeof value.filters === 'object' && !Array.isArray(value.filters)) {
    codeMap.filters = {
      query: typeof value.filters.query === 'string' ? value.filters.query : '',
      language: typeof value.filters.language === 'string' ? value.filters.language : '',
      symbolKind: typeof value.filters.symbolKind === 'string' ? value.filters.symbolKind : '',
      relationKind: typeof value.filters.relationKind === 'string' ? value.filters.relationKind : ''
    };
  }
  if (typeof value.groupByFolder === 'boolean') codeMap.groupByFolder = value.groupByFolder;
  if (typeof value.depth === 'string') codeMap.depth = value.depth;
  if (Number.isFinite(Number(value.zoom))) codeMap.zoom = Math.max(0.2, Math.min(3, Number(value.zoom)));
}

function restoreClientWorkspaceState(clientState) {
  if (!clientState || typeof clientState !== 'object' || Array.isArray(clientState)) return;
  if (Number(clientState.version) === CLIENT_WORKSPACE_VERSION) {
    if (typeof clientState.palette === 'string') savePalettePreference(clientState.palette);
    restoreSearchPreferences(clientState.searchPreferences);
    if (typeof clientState.sidebarSearchExpanded === 'boolean') persistSidebarSearchPreference(clientState.sidebarSearchExpanded);
    restoreDiagramWorkspaceState(clientState.diagrams);
    restoreCodeMapWorkspaceState(clientState.codeMap);
    persistSearchPreferences();
  }
}

async function selectWorkspaceFile() {
  if (typeof window.nexusData?.selectWorkspaceFile === 'function') return window.nexusData.selectWorkspaceFile();
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      try {
        resolve({ path: file.name, content: await file.text() });
      } catch (error) {
        reject(error);
      }
    }, { once: true });
    input.click();
  });
}

async function saveWorkspaceFile(content) {
  if (typeof window.nexusData?.saveWorkspaceFile === 'function') {
    return window.nexusData.saveWorkspaceFile({ content });
  }
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'nexusdata-workspace.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return link.download;
}

function setButtonBusy(button, busy, label) {
  if (!button) return;
  if (busy) {
    button.dataset.workspaceOriginalText = button.textContent;
    button.disabled = true;
    button.textContent = label;
  } else {
    button.disabled = false;
    button.textContent = button.dataset.workspaceOriginalText || button.textContent;
    delete button.dataset.workspaceOriginalText;
  }
}

async function exportWorkspace(button) {
  setButtonBusy(button, true, 'Exportando…');
  try {
    const serverState = await api('/workspace/export');
    const snapshot = {
      ...serverState,
      clientState: getClientWorkspaceState()
    };
    await saveWorkspaceFile(`${JSON.stringify(snapshot, null, 2)}\n`);
  } catch (error) {
    showToast(error.message || 'No se pudo exportar el espacio de trabajo', true);
  } finally {
    setButtonBusy(button, false);
  }
}

function importModalMarkup(filePath) {
  return `<div class="modal-backdrop"><div class="modal workspace-import-modal" role="dialog" aria-modal="true" aria-labelledby="workspace-import-title"><div class="modal-head"><div><h2 id="workspace-import-title">Importar espacio de trabajo</h2><p>Elige cómo combinar los datos del archivo con el espacio actual.</p></div><button class="modal-close" data-close-modal aria-label="Cerrar">×</button></div><div class="modal-body"><div class="workspace-file-name" title="${escapeHtml(filePath)}">${escapeHtml(filePath)}</div><div class="workspace-import-options"><label class="workspace-import-option"><input type="radio" name="workspace-import-mode" value="merge" checked /><span><strong>Fusionar</strong><small>Añade lo importado y conserva el resto del espacio actual.</small></span></label><label class="workspace-import-option workspace-import-option-danger"><input type="radio" name="workspace-import-mode" value="replace" /><span><strong>Reemplazar todo</strong><small>Elimina los datos actuales y restaura el contenido del archivo.</small></span></label></div><p id="workspace-import-error" class="form-error" role="alert" hidden></p></div><div class="modal-actions"><button class="btn btn-secondary" data-close-modal type="button">Cancelar</button><button id="workspace-import-submit" class="btn btn-primary" type="button">Importar</button></div></div></div>`;
}

function openWorkspaceImportModal(snapshot, filePath) {
  $('#modal-root').innerHTML = importModalMarkup(filePath);
  bindModalClose();
  const submit = $('#workspace-import-submit');
  const errorNode = $('#workspace-import-error');
  submit?.addEventListener('click', async () => {
    submit.disabled = true;
    const originalText = submit.textContent;
    submit.textContent = 'Importando…';
    if (errorNode) errorNode.hidden = true;
    try {
      const mode = document.querySelector('input[name="workspace-import-mode"]:checked')?.value || 'merge';
      await api('/workspace/import', {
        method: 'POST',
        body: JSON.stringify({ snapshot, mode })
      });
      restoreClientWorkspaceState(snapshot.clientState);
      closeModal();
      await refreshData();
    } catch (error) {
      if (errorNode) {
        errorNode.textContent = error.message || 'No se pudo importar el espacio de trabajo';
        errorNode.hidden = false;
      }
      showToast(error.message || 'No se pudo importar el espacio de trabajo', true);
    } finally {
      submit.disabled = false;
      submit.textContent = originalText;
    }
  });
  submit?.focus();
}

async function importWorkspace(button) {
  setButtonBusy(button, true, 'Cargando…');
  try {
    const selected = await selectWorkspaceFile();
    if (!selected) return;
    let snapshot;
    try {
      snapshot = JSON.parse(selected.content);
    } catch {
      throw new Error('El archivo seleccionado no contiene un JSON válido');
    }
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
      throw new Error('El archivo seleccionado no es un espacio de trabajo válido');
    }
    openWorkspaceImportModal(snapshot, selected.path || 'nexusdata-workspace.json');
  } catch (error) {
    showToast(error.message || 'No se pudo importar el espacio de trabajo', true);
  } finally {
    setButtonBusy(button, false);
  }
}

export function bindWorkspaceControls() {
  $('#workspace-export')?.addEventListener('click', (event) => { void exportWorkspace(event.currentTarget); });
  $('#workspace-import')?.addEventListener('click', (event) => { void importWorkspace(event.currentTarget); });
}
