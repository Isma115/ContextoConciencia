import { $, escapeHtml } from '../core/dom.js';
import { api } from '../core/api.js';
import { state } from '../core/state.js';
import { showToast } from '../ui/notifications.js';
import { openNewDiagramPromptModal } from './diagram-prompt-modal.js';

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
    const asset = files.get(resolveHtmlAsset(link.getAttribute('href'), entry.relativePath));
    if (!asset || asset.type !== 'css') return;
    const style = parsed.createElement('style');
    style.setAttribute('data-nexus-file', asset.relativePath);
    style.textContent = inlineCssImports(asset.content, asset.relativePath, files);
    link.replaceWith(style);
  });
  parsed.querySelectorAll('script[src]').forEach((script) => {
    const asset = files.get(resolveHtmlAsset(script.getAttribute('src'), entry.relativePath));
    if (!asset || asset.type !== 'javascript') return;
    const replacement = parsed.createElement('script');
    for (const attribute of script.attributes) {
      if (attribute.name !== 'src') replacement.setAttribute(attribute.name, attribute.value);
    }
    replacement.setAttribute('data-nexus-file', asset.relativePath);
    replacement.textContent = String(asset.content || '').replace(/<\/script/gi, '<\\/script');
    script.replaceWith(replacement);
  });
  return parsed.documentElement.outerHTML;
}

export function renderHtmlViewer() {
  const viewer = state.htmlViewer;
  const project = viewer.project;
  const files = project?.files || [];
  const selected = files.find((file) => file.relativePath === viewer.selectedFile) || files.find((file) => file.relativePath === project?.entry) || files[0] || null;
  const canPreview = Boolean(project?.entry);
  const mode = canPreview && viewer.mode === 'preview' ? 'preview' : 'code';
  const stage = mode === 'preview'
    ? '<iframe id="html-preview-frame" class="html-preview-frame" title="Previsualización del proyecto HTML" sandbox="allow-scripts"></iframe>'
    : selected
      ? `<pre class="html-code-view" aria-label="Contenido de ${escapeHtml(selected.relativePath)}"><code>${escapeHtml(selected.content)}</code></pre>`
      : '<div class="html-stage-empty">Sin archivo</div>';
  const errors = project?.errors?.length ? `<div class="html-viewer-warning">${project.errors.length} archivo${project.errors.length === 1 ? '' : 's'} no se pudo${project.errors.length === 1 ? '' : 'ieron'} leer.</div>` : '';
  $('#view-html-viewer').innerHTML = `<div class="html-viewer-shell">${viewer.loading ? '<div class="panel html-viewer-loading">Leyendo…</div>' : `<div class="html-viewer-workspace"><section class="html-viewer-panel"><div class="html-viewer-stage ${mode === 'preview' ? 'is-preview' : 'is-code'}">${stage}</div></section></div>${errors}`}</div>`;
  if (mode === 'preview' && canPreview) {
    const frame = $('#html-preview-frame');
    if (frame) frame.srcdoc = buildHtmlPreview(project);
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
    if (state.view !== 'html-viewer') return;
    if (action === 'choose-folder') chooseHtmlViewerPaths(true);
    if (action === 'choose-files') chooseHtmlViewerPaths(false);
    if (action === 'new-diagram-prompt') openNewDiagramPromptModal();
  });
}

async function loadHtmlProject(paths) {
  state.htmlViewer.loading = true;
  renderHtmlViewer();
  try {
    const project = await api('/html-viewer/inspect', { method: 'POST', body: JSON.stringify({ paths }) });
    state.htmlViewer.paths = project.paths || paths;
    state.htmlViewer.project = project;
    state.htmlViewer.selectedFile = project.entry || project.files?.[0]?.relativePath || null;
    state.htmlViewer.mode = project.entry ? 'preview' : 'code';
    showToast(`${project.files.length} archivo${project.files.length === 1 ? '' : 's'} listo${project.files.length === 1 ? '' : 's'} para visualizar`);
  } catch (error) {
    showToast(error.message, true);
  } finally {
    state.htmlViewer.loading = false;
    renderHtmlViewer();
  }
}
