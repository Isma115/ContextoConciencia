import { $, escapeHtml } from '../core/dom.js';
import { api } from '../core/api.js';
import { showToast } from '../ui/notifications.js';
import { closeModal, bindModalClose } from '../ui/modals.js';
import { state } from '../core/state.js';
import { typeLabel, shortDate } from '../core/format.js';

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
    const canRevealPath = Boolean(doc.path) && doc.type !== 'rest';
    const tags = doc.tags?.length ? doc.tags.map((tag) => `<span class="tag">#${escapeHtml(tag)}</span>`).join('') : '<span class="viewer-muted">Sin etiquetas</span>';
    const modeButton = isMarkdown ? '<button class="btn btn-secondary markdown-mode-button" id="toggle-markdown-mode" type="button" aria-label="Cambiar al modo de edición">✎ Editar</button>' : '';
    const viewer = isMarkdown
      ? `<div id="markdown-preview" class="markdown-preview" aria-label="Vista del documento Markdown">${window.NexusMarkdown.render(content)}</div><textarea id="document-content" class="document-content markdown-editor" aria-label="Editar contenido Markdown" spellcheck="false" hidden>${escapeHtml(content)}</textarea>`
      : `<textarea id="document-content" class="document-content" aria-label="Contenido del documento" spellcheck="false">${escapeHtml(content)}</textarea>`;
    const pathLabel = canRevealPath
      ? `<button id="reveal-document-path" class="viewer-path" type="button" title="Mostrar el archivo en el explorador">↳ ${escapeHtml(doc.path)}</button>`
      : `<span title="${escapeHtml(doc.path || '')}">↳ ${escapeHtml(doc.path || 'Sin ruta')}</span>`;
    $('#modal-root').innerHTML = `<div class="modal-backdrop"><div class="modal viewer-modal" role="dialog" aria-modal="true"><div class="modal-head"><div class="viewer-title-wrap"><input id="document-title" class="viewer-title" value="${escapeHtml(doc.title)}" aria-label="Título del documento" /><div class="viewer-subtitle">${escapeHtml(typeLabel(doc.type))} · ${escapeHtml(doc.source)}</div></div><div class="viewer-head-actions">${modeButton}<button class="modal-close" data-close-modal aria-label="Cerrar">×</button></div></div><div class="viewer-body"><div class="viewer-meta">${pathLabel}<span>${escapeHtml(shortDate(doc.updatedAt))}</span><div class="viewer-tags">${tags}</div></div>${viewer}</div><div class="modal-actions"><button class="btn btn-secondary" id="copy-document">Copiar</button><button class="btn btn-primary" id="save-document">Guardar cambios</button><button class="btn btn-secondary" data-close-modal>Cerrar</button></div></div></div>`;
    bindModalClose();
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
