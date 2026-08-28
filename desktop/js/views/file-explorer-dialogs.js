import { $, escapeHtml } from '../core/dom.js';
import { bindModalClose, closeModal } from '../ui/modals.js';

function explorerModalMarkup({ title, label, value = '', placeholder = '', submitLabel = 'Aceptar' }) {
  return `<div class="modal-backdrop"><div class="modal file-explorer-modal" role="dialog" aria-modal="true" aria-labelledby="file-explorer-modal-title"><div class="modal-head"><div><h2 id="file-explorer-modal-title">${escapeHtml(title)}</h2></div><button class="modal-close" data-close-modal aria-label="Cerrar">×</button></div><form id="file-explorer-name-form"><div class="modal-body"><label class="form-label">${escapeHtml(label)}<input id="file-explorer-name-input" class="field" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" maxlength="255" autocomplete="off" required /></label><p id="file-explorer-modal-error" class="form-error" role="alert" hidden></p></div><div class="modal-actions"><button class="btn btn-secondary" data-close-modal type="button">Cancelar</button><button id="file-explorer-modal-submit" class="btn btn-primary" type="submit">${escapeHtml(submitLabel)}</button></div></form></div></div>`;
}

export function openFileExplorerNameDialog({ title, label, value = '', placeholder = '', submitLabel = 'Aceptar', onSubmit }) {
  const root = $('#modal-root');
  if (!root) return;
  root.innerHTML = explorerModalMarkup({ title, label, value, placeholder, submitLabel });
  bindModalClose();
  const form = $('#file-explorer-name-form');
  const input = $('#file-explorer-name-input');
  const submit = $('#file-explorer-modal-submit');
  const error = $('#file-explorer-modal-error');
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = input?.value || '';
    if (!name.trim()) {
      if (error) {
        error.textContent = 'Escribe un nombre.';
        error.hidden = false;
      }
      return;
    }
    if (submit) {
      submit.disabled = true;
      submit.textContent = 'Guardando…';
    }
    if (error) error.hidden = true;
    try {
      await onSubmit(name);
      closeModal();
    } catch (operationError) {
      if (error) {
        error.textContent = operationError.message || 'No se pudo completar la operación';
        error.hidden = false;
      }
    } finally {
      if (submit) {
        submit.disabled = false;
        submit.textContent = submitLabel;
      }
    }
  });
  input?.focus();
  input?.select();
}

export function openFileExplorerDeleteDialog({ names = [], onConfirm }) {
  const root = $('#modal-root');
  if (!root) return;
  const visibleNames = names.slice(0, 5).map((name) => `<li>${escapeHtml(name)}</li>`).join('');
  const extra = names.length > 5 ? `<li>Y ${names.length - 5} elemento${names.length - 5 === 1 ? '' : 's'} más</li>` : '';
  root.innerHTML = `<div class="modal-backdrop"><div class="modal file-explorer-modal file-explorer-delete-modal" role="dialog" aria-modal="true" aria-labelledby="file-explorer-delete-title"><div class="modal-head"><div><h2 id="file-explorer-delete-title">Eliminar elementos</h2></div><button class="modal-close" data-close-modal aria-label="Cerrar">×</button></div><div class="modal-body"><p class="file-explorer-delete-copy">Esta acción no se puede deshacer.</p><ul class="file-explorer-delete-list">${visibleNames}${extra}</ul><p id="file-explorer-modal-error" class="form-error" role="alert" hidden></p></div><div class="modal-actions"><button class="btn btn-secondary" data-close-modal type="button">Cancelar</button><button id="file-explorer-delete-submit" class="btn btn-danger" type="button">Eliminar</button></div></div></div>`;
  bindModalClose();
  const submit = $('#file-explorer-delete-submit');
  const error = $('#file-explorer-modal-error');
  submit?.addEventListener('click', async () => {
    submit.disabled = true;
    submit.textContent = 'Eliminando…';
    if (error) error.hidden = true;
    try {
      await onConfirm();
      closeModal();
    } catch (operationError) {
      if (error) {
        error.textContent = operationError.message || 'No se pudieron eliminar los elementos';
        error.hidden = false;
      }
    } finally {
      submit.disabled = false;
      submit.textContent = 'Eliminar';
    }
  });
  submit?.focus();
}
