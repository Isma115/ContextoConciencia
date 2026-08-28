import { $, escapeHtml } from '../core/dom.js';
import { api } from '../core/api.js';
import { state } from '../core/state.js';
import { sectionIconMarkup } from '../core/section-icons.js';
import { showToast } from '../ui/notifications.js';
import { copyGitDiffPrompt, openNewDiagramPromptModal } from './diagram-prompt-modal.js';

let previewRenderId = 0;
let viewerLoadId = 0;
let navigateToView = null;

export function configureHtmlViewer({ onNavigate } = {}) {
  navigateToView = onNavigate || null;
}

export function htmlFileMap(project) {
  return new Map((project?.files || []).map((file) => [file.relativePath, file]));
}

export function resolveHtmlAsset(reference, currentFile) {
  const raw = String(reference || '').trim();
  if (!raw || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(raw)) return null;
  const clean = raw.split(/[?#]/, 1)[0];
  if (!clean) return null;
  const base = raw.startsWith('/') ? [] : String(currentFile || '').split('/').slice(0, -1);
  for (const segment of clean.replace(/^\/+/, '').split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') { base.pop(); continue; }
    base.push(segment);
  }
  return base.join('/');
}

function inlineCssImports(content, filePath, files, seen = new Set()) {
  if (seen.has(filePath)) return content;
  const nextSeen = new Set(seen).add(filePath);
  return String(content || '').replace(/@import\s+(?:url\(\s*)?["']([^"']+)["']\s*\)?\s*;/gi, (match, reference) => {
    const file = files.get(resolveHtmlAsset(reference, filePath));
    return file?.type === 'css' ? inlineCssImports(file.content, file.relativePath, files, nextSeen) : match;
  });
}

function isExecutableScript(script) {
  const type = String(script.getAttribute('type') || '').trim().toLowerCase();
  return !type || type === 'module' || /^(?:application|text)\/(?:java|ecma)script$/.test(type);
}

function recentHtmlViewerEntries() {
  return state.sources
    .filter((source) => source.config?.role === 'html-viewer')
    .flatMap((source) => (Array.isArray(source.config?.paths) ? source.config.paths : []).map((value) => {
      const path = String(value);
      return {
        source,
        path,
        name: path.split(/[\\/]/).filter(Boolean).pop() || path,
        isDocument: /\.html?$/i.test(path),
        timestamp: Date.parse(source.lastSyncAt || source.createdAt || '') || 0
      };
    }))
    .sort((first, second) => second.timestamp - first.timestamp || first.path.localeCompare(second.path))
    .slice(0, 8);
}

function recentHtmlViewerMarkup() {
  const entries = recentHtmlViewerEntries();
  if (!entries.length) {
    return '<div class="html-viewer-empty-copy"><strong>Sin documentos recientes</strong><span>Abre un archivo HTML o una carpeta desde el menú Archivo.</span></div>';
  }
  return `<div class="html-viewer-recent"><div class="html-viewer-recent-head"><strong>Recientes</strong><span>HTML y carpetas</span></div><div class="html-viewer-recent-list">${entries.map((entry) => `<button class="html-viewer-recent-item" type="button" data-html-recent-source="${escapeHtml(entry.source.id)}" data-html-recent-path="${escapeHtml(entry.path)}" title="${escapeHtml(entry.path)}"><span class="html-viewer-recent-icon">${entry.isDocument ? 'HTML' : 'DIR'}</span><span class="html-viewer-recent-copy"><strong>${escapeHtml(entry.name)}</strong><small>${escapeHtml(entry.source.name)}</small></span></button>`).join('')}</div></div>`;
}

function bindRecentHtmlViewerEntries(container) {
  container.querySelectorAll('[data-html-recent-source]').forEach((item) => item.addEventListener('click', () => {
    const source = state.sources.find((candidate) => candidate.id === item.dataset.htmlRecentSource);
    if (source) openPersistedHtmlSource(source, item.dataset.htmlRecentPath || null);
  }));
}

export function buildHtmlPreview(project) {
  if (!project?.entry) return '';
  const files = htmlFileMap(project);
  const entry = files.get(project.entry);
  if (!entry) return '';
  const parsed = new DOMParser().parseFromString(entry.content, 'text/html');
  parsed.querySelectorAll('meta[http-equiv]').forEach((meta) => {
    if (meta.getAttribute('http-equiv')?.toLowerCase() === 'content-security-policy') meta.remove();
  });
  parsed.querySelectorAll('link[href]').forEach((link) => {
    const reference = link.getAttribute('href');
    const asset = files.get(resolveHtmlAsset(reference, entry.relativePath));
    if (!asset || asset.type !== 'css') {
      if (reference && !reference.startsWith('#')) link.remove();
      return;
    }
    const style = parsed.createElement('style');
    style.setAttribute('data-nexus-file', asset.relativePath);
    style.textContent = inlineCssImports(asset.content, asset.relativePath, files);
    link.replaceWith(style);
  });
  parsed.querySelectorAll('script').forEach((script) => {
    if (!isExecutableScript(script)) return;
    const reference = script.getAttribute('src');
    const asset = reference ? files.get(resolveHtmlAsset(reference, entry.relativePath)) : null;
    if (reference && !asset) {
      script.remove();
      return;
    }
    const content = asset?.type === 'javascript' ? asset.content : script.textContent;
    if (!content) return;
    const replacement = parsed.createElement('script');
    for (const attribute of script.attributes) {
      if (!['src', 'integrity', 'crossorigin'].includes(attribute.name)) replacement.setAttribute(attribute.name, attribute.value);
    }
    if (asset) replacement.setAttribute('data-nexus-file', asset.relativePath);
    const source = String(content).replace(/<\/script/gi, '<\\/script');
    const shouldDefer = script.hasAttribute('defer') && script.getAttribute('type') !== 'module';
    replacement.removeAttribute('defer');
    replacement.textContent = shouldDefer ? `window.addEventListener('DOMContentLoaded', () => {\n${source}\n});` : source;
    script.replaceWith(replacement);
  });
  return parsed.documentElement.outerHTML;
}

export function renderHtmlViewer() {
  const renderId = ++previewRenderId;
  const viewer = state.htmlViewer;
  const project = viewer.project;
  const files = project?.files || [];
  const selected = files.find((file) => file.relativePath === viewer.selectedFile) || files.find((file) => file.relativePath === project?.entry) || files[0] || null;
  const canPreview = Boolean(project?.entry);
  const mode = canPreview && viewer.mode === 'preview' ? 'preview' : 'code';
  const stage = viewer.error
    ? `<div class="html-preview-error"><strong>No se pudo leer la carpeta</strong><span>${escapeHtml(viewer.error)}</span></div>`
    : !project
    ? recentHtmlViewerMarkup()
    : mode === 'preview'
    ? '<iframe id="html-preview-frame" class="html-preview-frame" title="Previsualización del proyecto HTML" sandbox="allow-scripts"></iframe>'
    : selected
      ? `<pre class="html-code-view" aria-label="Contenido de ${escapeHtml(selected.relativePath)}"><code>${escapeHtml(selected.content)}</code></pre>`
      : '<div class="html-stage-empty">Sin archivo</div>';
  const errors = project?.errors?.length ? `<div class="html-viewer-warning">${project.errors.length} archivo${project.errors.length === 1 ? '' : 's'} no se pudo${project.errors.length === 1 ? '' : 'ieron'} leer.</div>` : '';
  $('#view-html-viewer').innerHTML = `<div class="html-viewer-shell"><div class="html-viewer-decoration">${sectionIconMarkup('html')}</div>${viewer.loading ? '<div class="panel html-viewer-loading">Leyendo…</div>' : `<div class="html-viewer-workspace"><section class="html-viewer-panel"><div class="html-viewer-stage ${!project ? 'is-empty' : mode === 'preview' ? 'is-preview' : 'is-code'}">${stage}</div></section></div>${errors}`}</div>`;
  bindRecentHtmlViewerEntries($('#view-html-viewer'));
  if (mode === 'preview' && canPreview) {
    const frame = $('#html-preview-frame');
    if (frame) prepareHtmlPreview(frame, project, renderId);
  }
}

function rememberHtmlSource(source) {
  if (!source) return;
  const index = state.sources.findIndex((item) => item.id === source.id);
  if (index < 0) state.sources = [source, ...state.sources];
  else state.sources[index] = source;
}

function setViewerProject(project, sourceId, selectedPath = null) {
  const selected = project.files?.find((file) => file.path === selectedPath || file.relativePath === selectedPath);
  const entry = selected?.type === 'html' ? selected.relativePath : project.entry;
  const viewerProject = entry === project.entry ? project : { ...project, entry };
  state.htmlViewer.paths = project.paths || [];
  state.htmlViewer.sourceId = sourceId || null;
  state.htmlViewer.project = viewerProject;
  state.htmlViewer.error = '';
  state.htmlViewer.selectedFile = selected?.relativePath || project.entry || project.files?.[0]?.relativePath || null;
  state.htmlViewer.mode = viewerProject.entry ? 'preview' : 'code';
}

export async function openPersistedHtmlSource(source, selectedPath = null) {
  if (!source?.id) return;
  const loadId = ++viewerLoadId;
  state.htmlViewer.loading = true;
  state.htmlViewer.error = '';
  state.htmlViewer.project = null;
  state.htmlViewer.selectedFile = null;
  state.htmlViewer.sourceId = source.id;
  navigateToView?.('html-viewer');
  renderHtmlViewer();
  try {
    const result = await api(`/html-viewer/sources/${encodeURIComponent(source.id)}/project`);
    if (loadId !== viewerLoadId) return;
    rememberHtmlSource(result.source);
    setViewerProject(result.project, result.source?.id || source.id, selectedPath);
  } catch (error) {
    if (loadId !== viewerLoadId) return;
    state.htmlViewer.error = error.message;
    showToast(error.message, true);
  } finally {
    if (loadId === viewerLoadId) {
      state.htmlViewer.loading = false;
      renderHtmlViewer();
    }
  }
}

export function closeHtmlViewerDocument() {
  if (!state.htmlViewer.project && !state.htmlViewer.loading && !state.htmlViewer.error) return;
  viewerLoadId += 1;
  previewRenderId += 1;
  state.htmlViewer.paths = [];
  state.htmlViewer.sourceId = null;
  state.htmlViewer.project = null;
  state.htmlViewer.selectedFile = null;
  state.htmlViewer.mode = 'preview';
  state.htmlViewer.loading = false;
  state.htmlViewer.error = '';
  renderHtmlViewer();
}

async function prepareHtmlPreview(frame, project, renderId) {
  try {
    const html = buildHtmlPreview(project);
    const preview = await api('/html-viewer/preview', { method: 'POST', body: JSON.stringify({ html }) });
    if (renderId !== previewRenderId || frame !== $('#html-preview-frame')) return;
    const previewUrl = new URL(preview.path, window.location.href).href;
    const revealPreview = () => {
      if (renderId !== previewRenderId || frame !== $('#html-preview-frame')) {
        frame.removeEventListener('load', revealPreview);
        return;
      }
      if (frame.src !== previewUrl) return;
      frame.classList.add('is-ready');
      frame.removeEventListener('load', revealPreview);
    };
    frame.addEventListener('load', revealPreview);
    frame.src = preview.path;
  } catch (error) {
    if (renderId !== previewRenderId || frame !== $('#html-preview-frame')) return;
    const stage = frame.closest('.html-viewer-stage');
    if (stage) stage.innerHTML = `<div class="html-preview-error"><strong>No se pudo mostrar la previsualización</strong><span>${escapeHtml(error.message)}</span></div>`;
    showToast(error.message, true);
  }
}

async function chooseHtmlViewerPaths(directory) {
  try {
    if (typeof window.nexusData?.selectLocalPaths !== 'function') throw new Error('El selector de archivos no está disponible');
    const selected = await window.nexusData.selectLocalPaths({ directory });
    if (selected.length) await loadHtmlProject(selected);
  } catch (error) { showToast(error.message, true); }
}

export function bindHtmlViewerMenu() {
  window.nexusData?.onHtmlViewerMenuAction?.((action) => {
    if (action === 'new-diagram-prompt') {
      openNewDiagramPromptModal();
      return;
    }
    if (action === 'copy-git-diff-prompt') {
      copyGitDiffPrompt();
      return;
    }
    if (state.view !== 'html-viewer') return;
    if (action === 'choose-folder') chooseHtmlViewerPaths(true);
    if (action === 'choose-files') chooseHtmlViewerPaths(false);
    if (action === 'close-document') closeHtmlViewerDocument();
  });
}

async function loadHtmlProject(paths) {
  const loadId = ++viewerLoadId;
  state.htmlViewer.loading = true;
  state.htmlViewer.error = '';
  state.htmlViewer.sourceId = null;
  renderHtmlViewer();
  try {
    const result = await api('/html-viewer/sources', { method: 'POST', body: JSON.stringify({ paths }) });
    if (loadId !== viewerLoadId) return;
    rememberHtmlSource(result.source);
    setViewerProject(result.project, result.source?.id);
    showToast(`${result.sync?.total || result.project.files.length} recurso${(result.sync?.total || result.project.files.length) === 1 ? '' : 's'} guardado${(result.sync?.total || result.project.files.length) === 1 ? '' : 's'} en el buscador`);
  } catch (error) {
    if (loadId !== viewerLoadId) return;
    state.htmlViewer.error = error.message;
    showToast(error.message, true);
  } finally {
    if (loadId === viewerLoadId) {
      state.htmlViewer.loading = false;
      renderHtmlViewer();
    }
  }
}
