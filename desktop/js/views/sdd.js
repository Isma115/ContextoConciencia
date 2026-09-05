import { $, escapeHtml } from '../core/dom.js';
import { api } from '../core/api.js';
import { sectionIconMarkup } from '../core/section-icons.js';
import { showToast } from '../ui/notifications.js';
import { closeModal, bindModalClose } from '../ui/modals.js';
import { shortDate } from '../core/format.js';
import { state } from '../core/state.js';

const SPEC_STATUS = Object.freeze({ draft: 'Borrador', active: 'Activa', approved: 'Aprobada', implemented: 'Implementada' });
const MEDIA_KIND = Object.freeze({ text: 'Texto', image: 'Imagen', video: 'Vídeo' });
const SPECS_RESOURCES_FOLDER_NAME = 'specs_resources';
const SDD_PROJECT_PATH_STORAGE_KEY = 'nexusdata.sdd-project-path.v1';
let renderRequestId = 0;
let selectedMedia = { dataUrl: null, name: '' };

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

function sddHeader(icon, eyebrow, title, lead, { showEyebrow = true, showProjectName = true } = {}) {
  const eyebrowMarkup = showEyebrow ? `<span class="diagram-eyebrow">${escapeHtml(eyebrow)}</span>` : '';
  const project = state.sddProject?.path
    ? `<div class="sdd-project-context" title="${escapeHtml(state.sddProject.path)}">${showProjectName ? `<span>Proyecto: ${escapeHtml(state.sddProject.name || state.sddProject.path)}</span>` : ''}<span class="sdd-project-context-path">Ruta: ${escapeHtml(state.sddProject.path)}</span></div>`
    : '';
  return `<div class="section-top"><div class="section-heading-with-icon">${sectionIconMarkup(icon)}<div class="section-heading-copy">${eyebrowMarkup}<h1>${escapeHtml(title)}</h1><p class="lead">${escapeHtml(lead)}</p>${project}</div></div></div>`;
}

function sddToolbar(label, count, addId, addLabel, extraButton = '') {
  const copy = label || count
    ? `<div class="sdd-toolbar-copy"><h2>${escapeHtml(label)}</h2><span id="${addId}-count" class="sdd-count">${escapeHtml(count)}</span></div>`
    : '';
  return `<div class="sdd-toolbar">${copy}<div class="sdd-toolbar-actions">${extraButton}<button id="${addId}" class="btn btn-primary" type="button">${escapeHtml(addLabel)}</button></div></div>`;
}

function emptyState(title, description) {
  return `<div class="empty"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(description)}</span></div>`;
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

/* ----------------------------------------------------------------- Inyectar */

function renderSddProjectRequired(container, icon, eyebrow, title, lead, headerOptions = {}) {
  if (hasSddProject()) return false;
  container.innerHTML = `${sddHeader(icon, eyebrow, title, lead, headerOptions)}${emptyState('Sin proyecto S.D.D', 'Usa “Cargar” para seleccionar un proyecto que contenga specs.md y specs_resources.')}`;
  return true;
}

function renderActiveSddViews() {
  if (isViewActive('view-sdd-specs')) renderSddSpecs();
  if (isViewActive('view-sdd-database')) renderSddDatabase();
  if (isViewActive('view-sdd-ui')) renderSddUi();
  if (isViewActive('view-sdd-resources')) renderSddResources();
}

export function bindSddInject() {
  const button = $('#sdd-inject');
  if (!button) return;
  const storedPath = currentSddProjectPath();
  if (storedPath) button.title = `Carpeta de specs (${storedPath})`;
  button.addEventListener('click', async () => {
    if (button.disabled) return;
    if (typeof window.nexusData?.selectSddSpecsPath !== 'function') {
      showToast('El selector de carpetas no está disponible en esta ventana', true);
      return;
    }
    button.disabled = true;
    button.textContent = '…';
    try {
      const selection = await window.nexusData.selectSddSpecsPath(currentSddProjectPath());
      if (!selection) return;
      showToast(selection.created ? 'specs.md y specs_resources creados' : 'specs.md ya existía, no se ha modificado nada');
    } catch (error) {
      showToast(error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = 'Inyectar';
    }
  });
}

/* -------------------------------------------------------------------- Cargar */

async function openSpecsMarkdownEditor() {
  if (!hasSddProject()) return;
  try {
    const { path, markdown } = await sddApi('/sdd/specs/markdown');
    $('#modal-root').innerHTML = `<div class="modal-backdrop"><div class="modal sdd-md-modal" role="dialog" aria-modal="true" aria-labelledby="sdd-md-modal-title"><div class="modal-head"><div><h2 id="sdd-md-modal-title">Editar specs.md del proyecto</h2><p>${escapeHtml(path)}</p></div><button class="modal-close" data-close-modal aria-label="Cerrar">×</button></div><div class="modal-body"><textarea id="sdd-md-content" class="textarea sdd-md-textarea" spellcheck="false">${escapeHtml(markdown)}</textarea></div><div class="modal-actions"><button class="btn btn-secondary" data-close-modal type="button">Cancelar</button><button id="sdd-md-apply" class="btn btn-primary" type="button">Aplicar al proyecto</button></div></div></div>`;
    bindModalClose();
    $('#sdd-md-apply').addEventListener('click', async () => {
      const content = $('#sdd-md-content');
      const button = $('#sdd-md-apply');
      button.disabled = true;
      try {
        const result = await sddApi('/sdd/specs/sync', { method: 'POST', body: JSON.stringify({ markdown: content.value }) });
        closeModal();
        showToast(`${result.total} ${result.total === 1 ? 'requisito' : 'requisitos'} sincronizados desde specs.md`);
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

export function bindSddLoad() {
  const button = $('#sdd-load');
  if (!button) return;
  button.addEventListener('click', async () => {
    const loadProject = window.nexusData?.loadSddProject || window.nexusData?.loadSddSpecsMarkdown;
    if (typeof loadProject !== 'function') {
      showToast('El selector de carpetas no está disponible en esta ventana', true);
      return;
    }
    button.disabled = true;
    button.textContent = '…';
    try {
      const selection = await loadProject();
      if (!selection) return;
      const result = await api('/sdd/project', { method: 'POST', body: JSON.stringify({ path: selection.path }) });
      setSddProject(result.project, { refresh: true });
      showToast(`${result.total} ${result.total === 1 ? 'requisito' : 'requisitos'} cargados desde el proyecto S.D.D`);
      renderActiveSddViews();
    } catch (error) {
      showToast(error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = 'Cargar';
    }
  });
}

export function bindSddReload() {
  const button = $('#sdd-reload');
  if (!button) return;
  button.addEventListener('click', async () => {
    const loadProject = window.nexusData?.loadSddProject || window.nexusData?.loadSddSpecsMarkdown;
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

function specBadges(spec) {
  const category = spec.category ? `<span class="sdd-badge sdd-badge-category">${escapeHtml(spec.category)}</span>` : '';
  return `${category}<span class="sdd-badge sdd-status-${escapeHtml(spec.status)}">${SPEC_STATUS[spec.status] || escapeHtml(spec.status)}</span>`;
}

function specCard(spec) {
  return `<article class="sdd-card" data-spec-id="${escapeHtml(spec.id)}">
    <div class="sdd-card-head">
      <div class="sdd-card-main">
        <h3 class="sdd-card-title">${escapeHtml(spec.title)}</h3>
        <div class="sdd-badges">${specBadges(spec)}</div>
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
  const list = $('#sdd-spec-list');
  if (!list) return;
  list.innerHTML = specs.length
    ? specs.map(specCard).join('')
    : emptyState('Sin requisitos', 'Usa “＋ Añadir spec”.');
  list.querySelectorAll('[data-edit-spec]').forEach((button) => button.addEventListener('click', () => {
    const spec = specs.find((item) => item.id === button.dataset.editSpec);
    if (spec) openSpecModal(spec);
  }));
  list.querySelectorAll('[data-delete-spec]').forEach((button) => button.addEventListener('click', async () => {
    const spec = specs.find((item) => item.id === button.dataset.deleteSpec);
    if (!spec) return;
    if (!await confirmDelete(`¿Eliminar la spec “${spec.title}”?`)) return;
    try {
      await sddApi(`/sdd/specs/${spec.id}`, { method: 'DELETE' });
      showToast('Spec eliminada');
      renderSddSpecs();
    } catch (error) { showToast(error.message, true); }
  }));
}

function openSpecModal(existing = null) {
  const statusOptions = Object.entries(SPEC_STATUS).map(([value, label]) => `<option value="${value}"${existing?.status === value ? ' selected' : ''}>${label}</option>`).join('');
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="sdd-spec-modal-title"><div class="modal-head"><div><h2 id="sdd-spec-modal-title">${existing ? 'Editar spec' : 'Añadir spec'}</h2></div><button class="modal-close" data-close-modal aria-label="Cerrar">×</button></div><div class="modal-body"><div class="form-grid"><label class="form-label">Título<input id="spec-title" class="field" type="text" value="${escapeHtml(existing?.title || '')}" maxlength="200" autocomplete="off" autofocus /></label><label class="form-label">Estado<select id="spec-status" class="select">${statusOptions}</select></label><label class="form-label">Categoría<input id="spec-category" class="field" type="text" value="${escapeHtml(existing?.category || '')}" maxlength="60" autocomplete="off" /></label><label class="form-label">Descripción<textarea id="spec-description" class="textarea" maxlength="10000">${escapeHtml(existing?.description || '')}</textarea></label></div></div><div class="modal-actions"><button class="btn btn-secondary" data-close-modal type="button">Cancelar</button><button id="spec-save" class="btn btn-primary" type="button">${existing ? 'Guardar cambios' : 'Añadir spec'}</button></div></div></div>`;
  bindModalClose();
  $('#spec-save').addEventListener('click', async () => {
    try {
      const body = {
        title: $('#spec-title').value.trim(),
        status: $('#spec-status').value,
        category: $('#spec-category').value.trim(),
        description: $('#spec-description').value
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
  const headerOptions = { showEyebrow: false, showProjectName: false };
  if (renderSddProjectRequired(container, 'specs', 'S.D.D · SPECS', 'Specs', 'Qué debe hacer el sistema.', headerOptions)) return;
  const requestId = ++renderRequestId;
  container.innerHTML = `${sddHeader('specs', 'S.D.D · SPECS', 'Specs', 'Qué debe hacer el sistema.', headerOptions)}${sddToolbar('', '', 'sdd-spec-add', '＋ Añadir spec', '<button id="sdd-md-edit" class="btn btn-secondary" type="button" title="Volver a leer y editar specs.md del proyecto">Editar markdown</button>')}<div class="sdd-list" id="sdd-spec-list"><div class="empty">Cargando especificaciones…</div></div>`;
  $('#sdd-spec-add').addEventListener('click', () => openSpecModal());
  const mdEdit = $('#sdd-md-edit');
  if (mdEdit) mdEdit.addEventListener('click', openSpecsMarkdownEditor);
  sddApi('/sdd/specs').then(({ specs }) => {
    if (requestId !== renderRequestId || !isViewActive('view-sdd-specs')) return;
    renderSpecList(specs);
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
  const count = $('#sdd-db-add-count');
  if (count) count.textContent = `${tables.length} ${tables.length === 1 ? 'tabla' : 'tablas'}`;
  const list = $('#sdd-db-list');
  if (!list) return;
  list.innerHTML = tables.length
    ? tables.map(tableCard).join('')
    : emptyState('Sin tablas', 'Usa “＋ Añadir tabla”.');
  list.querySelectorAll('[data-add-column]').forEach((button) => button.addEventListener('click', () => {
    openColumnModal(tables.find((item) => item.id === button.dataset.addColumn));
  }));
  list.querySelectorAll('[data-edit-table]').forEach((button) => button.addEventListener('click', () => {
    openTableModal(tables.find((item) => item.id === button.dataset.editTable));
  }));
  list.querySelectorAll('[data-delete-table]').forEach((button) => button.addEventListener('click', async () => {
    const table = tables.find((item) => item.id === button.dataset.deleteTable);
    if (!table) return;
    if (!await confirmDelete(`¿Eliminar la tabla “${table.name}” y sus ${table.columns.length} columnas?`)) return;
    try {
      await sddApi(`/sdd/db/tables/${table.id}`, { method: 'DELETE' });
      showToast('Tabla eliminada');
      renderSddDatabase();
    } catch (error) { showToast(error.message, true); }
  }));
  list.querySelectorAll('[data-edit-column]').forEach((button) => {
    const table = tables.find((item) => item.columns.some((column) => column.id === button.dataset.editColumn));
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
  if (renderSddProjectRequired(container, 'database', 'S.D.D · BASE DE DATOS', 'Base de datos', 'Tablas, columnas y restricciones.')) return;
  const requestId = ++renderRequestId;
  container.innerHTML = `${sddHeader('database', 'S.D.D · BASE DE DATOS', 'Base de datos', 'Tablas, columnas y restricciones.')}${sddToolbar('Tablas', '…', 'sdd-db-add', '＋ Añadir tabla')}<div class="sdd-list" id="sdd-db-list"><div class="empty">Cargando esquema…</div></div>`;
  $('#sdd-db-add').addEventListener('click', () => openTableModal());
  sddApi('/sdd/db').then(({ tables }) => {
    if (requestId !== renderRequestId || !isViewActive('view-sdd-database')) return;
    renderTableList(tables);
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
  if (item.fileMissing || !item.fileUrl) return '<div class="sdd-media-text">No se encuentra el fichero en specs_resources.</div>';
  if (item.kind === 'image') return `<img src="${escapeHtml(item.fileUrl)}" alt="${escapeHtml(item.title)}" loading="lazy" />`;
  if (item.kind === 'video') return `<video src="${escapeHtml(item.fileUrl)}" controls preload="metadata"></video>`;
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
  const count = $('#sdd-ui-add-count');
  if (count) count.textContent = `${items.length} ${items.length === 1 ? 'contenido' : 'contenidos'}`;
  const list = $('#sdd-ui-list');
  if (!list) return;
  list.innerHTML = items.length
    ? items.map(mediaCard).join('')
    : emptyState('Sin contenido', 'Usa “＋ Añadir contenido”.');
  list.querySelectorAll('[data-edit-media]').forEach((button) => button.addEventListener('click', () => {
    const item = items.find((media) => media.id === button.dataset.editMedia);
    if (item) openMediaModal(item);
  }));
  list.querySelectorAll('[data-delete-media]').forEach((button) => button.addEventListener('click', async () => {
    const item = items.find((media) => media.id === button.dataset.deleteMedia);
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
  zone.innerHTML = `<div class="form-label">Archivo<div class="sdd-media-picker"><button id="media-pick-file" class="btn btn-secondary btn-small" type="button">${kind === 'image' ? 'Seleccionar imagen…' : 'Seleccionar vídeo…'}</button><span class="form-note">${selectedName}</span></div>${mediaPreviewMarkup(kind, selectedMedia.dataUrl)}</div>`;
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
  if (renderSddProjectRequired(container, 'ui', 'S.D.D · UI', 'UI', 'Referencias visuales del diseño.')) return;
  const requestId = ++renderRequestId;
  container.innerHTML = `${sddHeader('ui', 'S.D.D · UI', 'UI', 'Referencias visuales del diseño.')}${sddToolbar('Referencias de diseño', '…', 'sdd-ui-add', '＋ Añadir contenido')}<div class="sdd-media-grid" id="sdd-ui-list"><div class="empty">Cargando contenido…</div></div>`;
  $('#sdd-ui-add').addEventListener('click', () => openMediaModal());
  sddApi('/sdd/media').then(({ media }) => {
    if (requestId !== renderRequestId || !isViewActive('view-sdd-ui')) return;
    renderMediaList(media);
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
  const frame = resource.kind === 'video'
    ? `<video src="${escapeHtml(resource.dataUrl)}" controls preload="metadata"></video>`
    : `<img src="${escapeHtml(resource.dataUrl)}" alt="${escapeHtml(resource.name)}" loading="lazy" />`;
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
  const count = $('#sdd-resource-count');
  if (count) count.textContent = `${resources.length} ${resources.length === 1 ? 'recurso' : 'recursos'}`;
  const list = $('#sdd-resource-list');
  if (!list) return;
  list.innerHTML = resources.length
    ? resources.map(resourceCard).join('')
    : emptyState('Sin recursos multimedia', `Coloca imágenes o vídeos en la carpeta “${SPECS_RESOURCES_FOLDER_NAME}”.`);
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
  const folder = specsResourcesFolder();
  if (!folder) return null;
  if (typeof window.nexusData?.readSddSpecsResources !== 'function') {
    throw new Error('El acceso a la carpeta de recursos no está disponible en esta ventana');
  }
  const result = await window.nexusData.readSddSpecsResources(folder);
  return { folder: result.path, resources: result.resources };
}

export function renderSddResources() {
  const container = $('#view-sdd-resources');
  if (!container) return;
  if (renderSddProjectRequired(container, 'resources', 'S.D.D · RECURSOS', 'Recursos', `Imágenes y vídeos de la carpeta “${SPECS_RESOURCES_FOLDER_NAME}”.`)) return;
  container.innerHTML = `${sddHeader('resources', 'S.D.D · RECURSOS', 'Recursos', `Imágenes y vídeos de la carpeta “${SPECS_RESOURCES_FOLDER_NAME}”.`)}<div class="sdd-toolbar"><div class="sdd-toolbar-copy"><h2>Recursos multimedia</h2><span id="sdd-resource-count" class="sdd-count">…</span></div><div class="sdd-toolbar-actions"><button id="sdd-resource-refresh" class="btn btn-secondary" type="button" title="Volver a leer la carpeta de recursos">Actualizar</button></div></div><div class="sdd-card-meta sdd-resource-folder" id="sdd-resource-folder"></div><div class="sdd-media-grid" id="sdd-resource-list"><div class="empty">Cargando recursos…</div></div>`;
  const showResources = (data, id) => {
    if (id !== renderRequestId || !isViewActive('view-sdd-resources')) return;
    const folderNode = $('#sdd-resource-folder');
    if (folderNode) folderNode.textContent = data?.folder ? `Carpeta: ${data.folder}/${SPECS_RESOURCES_FOLDER_NAME}` : '';
    if (!data) {
      const count = $('#sdd-resource-count');
      if (count) count.textContent = '…';
      $('#sdd-resource-list').innerHTML = emptyState('Sin carpeta de specs', 'Usa “Inyectar” o “Cargar” para elegir la carpeta de specs.');
      return;
    }
    renderResourceList(data.resources);
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
