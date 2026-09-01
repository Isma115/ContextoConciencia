import { $, escapeHtml } from '../core/dom.js';
import { api } from '../core/api.js';
import { showToast } from '../ui/notifications.js';
import { closeModal, bindModalClose } from '../ui/modals.js';
import { state } from '../core/state.js';

let refreshData = async () => {};
let openHtmlViewer = null;
let openDiagram = null;

export function configureDocuments({ onRefresh, onOpenHtmlViewer, onOpenDiagram } = {}) {
  refreshData = onRefresh || refreshData;
  openHtmlViewer = onOpenHtmlViewer || openHtmlViewer;
  openDiagram = onOpenDiagram || openDiagram;
}

function bindHtmlSourceOpeners(container) {
  container.querySelectorAll('[data-view-html-source]').forEach((card) => {
    const open = (event) => {
      if (event.target.closest('button, select, input, textarea, a')) return;
      const source = state.sources.find((item) => item.id === card.dataset.viewHtmlSource);
      if (source && openHtmlViewer) openHtmlViewer(source);
    };
    card.addEventListener('click', open);
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open(event);
      }
    });
  });
}

export function bindDocumentOpeners(container) {
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
  bindHtmlSourceOpeners(container);
}

export function favoriteButtonMarkup(doc) {
  const favorite = doc?.favorite === true;
  const label = favorite ? 'Quitar de favoritos' : 'Añadir a favoritos';
  return `<button type="button" class="btn btn-secondary btn-small favorite-toggle${favorite ? ' is-favorite' : ''}" data-document-favorite="${escapeHtml(doc.id)}" aria-label="${label}" aria-pressed="${favorite}" title="${label}">${favorite ? '★' : '☆'}</button>`;
}

export function copyPathButtonMarkup(path, { small = true, className = '' } = {}) {
  if (path === null || path === undefined || String(path).trim() === '') return '';
  const sizeClass = small ? ' btn-small' : '';
  const extraClass = className ? ` ${className}` : '';
  return `<button type="button" class="btn btn-secondary${sizeClass} copy-path-button${extraClass}" data-copy-path="${escapeHtml(path)}" aria-label="Copiar ruta" title="Copiar ruta">Copiar ruta</button>`;
}

export async function copyPathToClipboard(path) {
  const value = String(path || '').trim();
  if (!value) throw new Error('La ruta no está disponible');
  if (typeof navigator === 'undefined' || !navigator.clipboard?.writeText) throw new Error('El portapapeles no está disponible');
  await navigator.clipboard.writeText(value);
}

export function bindCopyPathActions(container) {
  container?.querySelectorAll('[data-copy-path]').forEach((button) => {
    if (button.dataset.copyPathBound === 'true') return;
    button.dataset.copyPathBound = 'true';
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled) return;
      button.disabled = true;
      try {
        await copyPathToClipboard(button.dataset.copyPath);
      } catch (error) {
        showToast(error.message, true);
      } finally {
        button.disabled = false;
      }
    });
    button.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
    });
  });
}

export function bindDocumentFavoriteActions(container, { onRefresh = refreshData } = {}) {
  container.querySelectorAll('[data-document-favorite]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      const favorite = button.getAttribute('aria-pressed') !== 'true';
      button.disabled = true;
      try {
        await api(`/documents/${encodeURIComponent(button.dataset.documentFavorite)}/favorite`, {
          method: 'PATCH',
          body: JSON.stringify({ favorite })
        });
        await onRefresh?.();
      } catch (error) {
        showToast(error.message, true);
      } finally {
        button.disabled = false;
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

export async function openDocument(id) {
  try {
    const doc = await api(`/documents/${encodeURIComponent(id)}`);
    const source = state.sources.find((item) => item.id === doc.sourceId);
    const htmlTypes = new Set(['html', 'css', 'javascript']);
    if (source?.config?.role === 'html-viewer' && htmlTypes.has(doc.type) && openHtmlViewer) {
      await openHtmlViewer(source, doc.path);
      return;
    }
    if (doc.type === 'diagram' && openDiagram) {
      await openDiagram(doc);
      return;
    }
    const isMarkdown = doc.type === 'markdown';
    const content = documentContent(doc);
    const hasPath = Boolean(doc.path);
    const canRevealPath = hasPath && doc.type !== 'rest';
    const modeButton = isMarkdown ? '<button class="btn btn-secondary markdown-mode-button" id="toggle-markdown-mode" type="button" aria-label="Cambiar al modo de edición">✎ Editar</button>' : '';
    const viewer = isMarkdown
      ? `<div id="markdown-preview" class="markdown-preview" aria-label="Vista del documento Markdown">${window.NexusMarkdown.render(content)}</div><textarea id="document-content" class="document-content markdown-editor" aria-label="Editar contenido Markdown" spellcheck="false" hidden>${escapeHtml(content)}</textarea>`
      : `<textarea id="document-content" class="document-content" aria-label="Contenido del documento" spellcheck="false">${escapeHtml(content)}</textarea>`;
    const pathLabel = canRevealPath
      ? `<button id="reveal-document-path" class="viewer-path viewer-title-path" type="button" title="Mostrar el archivo en el explorador">↳ ${escapeHtml(doc.path)}</button>`
      : hasPath ? `<span class="viewer-title-path" title="${escapeHtml(doc.path)}">↳ ${escapeHtml(doc.path)}</span>` : '';
    $('#modal-root').innerHTML = `<div class="modal-backdrop viewer-modal-backdrop"><div class="modal viewer-modal" role="dialog" aria-modal="true"><div class="modal-head"><button class="modal-close" data-close-modal aria-label="Cerrar">×</button><div class="viewer-title-wrap"><div class="viewer-title-line"><input id="document-title" class="viewer-title" value="${escapeHtml(doc.title)}" aria-label="Título del documento" />${pathLabel}</div></div><div class="viewer-head-actions">${modeButton}</div></div><div class="viewer-body">${viewer}</div><div class="modal-actions"><button class="btn btn-secondary" id="copy-document">Copiar</button>${copyPathButtonMarkup(doc.path, { small: false })}<button class="btn btn-primary" id="save-document">Guardar cambios</button></div></div></div>`;
    bindModalClose();
    bindCopyPathActions($('#modal-root'));
    if (canRevealPath) {
      $('#reveal-document-path').addEventListener('click', async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        try {
          if (typeof window.nexusData?.revealFile !== 'function') throw new Error('El explorador de archivos no está disponible');
          await window.nexusData.revealFile(doc.path);
          showToast('Archivo mostrado en el explorador');
        } catch (error) {
          showToast(error.message, true);
        } finally {
          button.disabled = false;
        }
      });
    }
    if (isMarkdown) {
      const modeButtonNode = $('#toggle-markdown-mode');
      const editor = $('#document-content');
      const preview = $('#markdown-preview');
      modeButtonNode.addEventListener('click', () => {
        const editing = !editor.hidden;
        if (editing) {
          preview.innerHTML = window.NexusMarkdown.render(editor.value);
          editor.hidden = true;
          preview.hidden = false;
          modeButtonNode.textContent = '✎ Editar';
          modeButtonNode.setAttribute('aria-label', 'Cambiar al modo de edición');
        } else {
          preview.hidden = true;
          editor.hidden = false;
          modeButtonNode.textContent = '◉ Vista';
          modeButtonNode.setAttribute('aria-label', 'Cambiar al modo de vista');
          editor.focus();
        }
      });
    }
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
