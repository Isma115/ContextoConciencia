import { $, escapeHtml } from '../core/dom.js';
import { api, apiUrl } from '../core/api.js';
import { formatBytes, typeLabel } from '../core/format.js';
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

export function revealButtonMarkup(doc, { className = '' } = {}) {
  const path = doc?.path;
  if (path === null || path === undefined || String(path).trim() === '') return '';
  if (doc?.type === 'rest') return '';
  const extraClass = className ? ` ${className}` : '';
  return `<button type="button" class="btn btn-secondary btn-small reveal-path-button${extraClass}" data-reveal-path="${escapeHtml(path)}" aria-label="Ver en Explorador" title="Mostrar el fichero en el explorador de archivos del sistema">Ver en Explorador</button>`;
}

export function bindRevealActions(container) {
  container?.querySelectorAll('[data-reveal-path]').forEach((button) => {
    if (button.dataset.revealPathBound === 'true') return;
    button.dataset.revealPathBound = 'true';
    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled) return;
      button.disabled = true;
      try {
        if (typeof window.nexusData?.revealFile !== 'function') throw new Error('El explorador de archivos no está disponible');
        await window.nexusData.revealFile(button.dataset.revealPath);
        showToast('Archivo mostrado en el explorador');
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

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'avif', 'bmp', 'tif', 'tiff', 'svg']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'm4v', 'webm', 'ogv', 'mov']);
const TEXT_VIEW_TYPES = new Set(['markdown', 'json', 'csv', 'text', 'html', 'css', 'javascript', 'rest']);

export function isUnsupportedFormat(doc) {
  if (mediaKindFor(doc)) return false;
  if (TEXT_VIEW_TYPES.has(doc.type)) return false;
  if (doc.metadata?.binary === true || doc.metadata?.contentSkipped === 'too-large') return true;
  const content = doc.content === null || doc.content === undefined ? '' : String(doc.content);
  if (content.trim() === '') return true;
  if (doc.type === 'image' || doc.type === 'gif' || doc.type === 'video') return true;
  return false;
}

export function mediaKindFor(doc) {
  if (!doc?.path || doc.type === 'rest') return null;
  const kind = doc.metadata?.mediaKind;
  if (kind === 'image' || kind === 'video') return kind;
  if (doc.type === 'image' || doc.type === 'gif') return 'image';
  if (doc.type === 'video') return 'video';
  const extension = String(doc.path).split('.').pop().toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension) || extension === 'gif') return 'image';
  if (VIDEO_EXTENSIONS.has(extension)) return 'video';
  return null;
}

export function mediaSnippetLabel(doc) {
  const kind = mediaKindFor(doc);
  if (!kind) return '';
  const label = doc.type === 'gif' ? 'GIF' : kind === 'video' ? 'Vídeo' : 'Imagen';
  const size = Number(doc.metadata?.size);
  return Number.isFinite(size) && size > 0 ? `${label} · ${formatBytes(size)}` : label;
}

function openMediaViewer(doc) {
  const kind = mediaKindFor(doc);
  const fileUrl = apiUrl(`/documents/${encodeURIComponent(doc.id)}/file`);
  const isVideo = kind === 'video';
  const title = escapeHtml(doc.title || 'Sin título');
  const media = isVideo
    ? `<video id="document-media" class="media-viewer media-viewer-video" src="${escapeHtml(fileUrl)}" controls preload="metadata" playsinline aria-label="${title}"></video>`
    : `<img id="document-media" class="media-viewer" src="${escapeHtml(fileUrl)}" alt="${title}" draggable="false" />`;
  const pathLabel = doc.path
    ? `<button id="reveal-document-path" class="viewer-path viewer-title-path" type="button" title="Mostrar el archivo en el explorador">↳ ${escapeHtml(doc.path)}</button>`
    : '';
  $('#modal-root').innerHTML = `<div class="modal-backdrop viewer-modal-backdrop"><div class="modal viewer-modal" role="dialog" aria-modal="true"><div class="modal-head"><button class="modal-close" data-close-modal aria-label="Cerrar">×</button><div class="viewer-title-wrap"><div class="viewer-title-line"><span class="viewer-title" title="${title}">${title}</span>${pathLabel}</div><span class="media-viewer-kind">${escapeHtml(mediaSnippetLabel(doc))}</span></div></div><div class="viewer-body media-viewer-body">${media}<div id="media-viewer-error" class="media-viewer-error" hidden>No se pudo cargar el archivo. Puede que se haya movido o modificado en disco.</div></div><div class="modal-actions">${copyPathButtonMarkup(doc.path, { small: false })}${revealButtonMarkup(doc)}</div></div></div>`;
  bindModalClose();
  bindCopyPathActions($('#modal-root'));
  bindRevealActions($('#modal-root'));
  const mediaNode = $('#document-media');
  mediaNode.addEventListener('error', () => {
    mediaNode.hidden = true;
    $('#media-viewer-error').hidden = false;
  });
  if (isVideo) {
    mediaNode.addEventListener('click', (event) => event.stopPropagation());
  }
  if (doc.path) {
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
}

function openUnsupportedViewer(doc) {
  const title = escapeHtml(doc.title || 'Sin título');
  const pathLabel = doc.path
    ? `<button id="reveal-document-path" class="viewer-path viewer-title-path" type="button" title="Mostrar el archivo en el explorador">↳ ${escapeHtml(doc.path)}</button>`
    : '';
  $('#modal-root').innerHTML = `<div class="modal-backdrop viewer-modal-backdrop"><div class="modal viewer-modal" role="dialog" aria-modal="true"><div class="modal-head"><button class="modal-close" data-close-modal aria-label="Cerrar">×</button><div class="viewer-title-wrap"><div class="viewer-title-line"><span class="viewer-title" title="${title}">${title}</span>${pathLabel}</div><span class="media-viewer-kind">${escapeHtml(typeLabel(doc.type))}</span></div></div><div class="viewer-body unsupported-viewer-body"><p class="unsupported-viewer-message">Formato no compatible</p>${revealButtonMarkup(doc, { className: 'unsupported-viewer-button' })}</div><div class="modal-actions">${copyPathButtonMarkup(doc.path, { small: false })}</div></div></div>`;
  bindModalClose();
  bindCopyPathActions($('#modal-root'));
  bindRevealActions($('#modal-root'));
  if (doc.path) {
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
}

export async function openDocument(id) {
  try {
    const doc = await api(`/documents/${encodeURIComponent(id)}`);
    api(`/documents/${encodeURIComponent(doc.id)}/open`, { method: 'POST' }).catch(() => {});
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
    if (mediaKindFor(doc)) {
      openMediaViewer(doc);
      return;
    }
    if (isUnsupportedFormat(doc)) {
      openUnsupportedViewer(doc);
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
