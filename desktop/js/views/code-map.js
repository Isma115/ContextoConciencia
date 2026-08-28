import { $, escapeHtml } from '../core/dom.js';
import { api } from '../core/api.js';
import { state } from '../core/state.js';
import { showToast } from '../ui/notifications.js';
import {
  languageLabel,
  minimapMarkup,
  relationLabel,
  renderCodeMapGraph
} from './code-map-graph.js';

let navigateToView = () => {};
let filesRequestId = 0;
let analysisRequestId = 0;
let analysisController = null;
const CODE_MAP_TREE_WIDTH_KEY = 'nexusdata.code-map-tree-width.v1';
const CODE_MAP_TREE_WIDTH_DEFAULT = 210;
const CODE_MAP_TREE_WIDTH_MIN = 180;
const CODE_MAP_TREE_WIDTH_MAX = 720;
const CODE_MAP_CANVAS_WIDTH_MIN = 320;
const CODE_MAP_RESIZER_WIDTH = 10;
let codeMapTreeWidth = loadCodeMapTreeWidth();
let codeMapResizeState = null;
let codeMapResizeEventsBound = false;

export function configureCodeMap({ onNavigate } = {}) {
  navigateToView = onNavigate || navigateToView;
}

function codeMapState() { return state.codeMap; }
function formatBytes(value) { return value > 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} MB` : value > 1024 ? `${Math.round(value / 1024)} KB` : `${value || 0} B`; }

function normaliseCodeMapTreeWidth(value) {
  if (value == null || value === '') return CODE_MAP_TREE_WIDTH_DEFAULT;
  const width = Number(value);
  if (!Number.isFinite(width)) return CODE_MAP_TREE_WIDTH_DEFAULT;
  return Math.max(CODE_MAP_TREE_WIDTH_MIN, Math.min(CODE_MAP_TREE_WIDTH_MAX, width));
}

function loadCodeMapTreeWidth() {
  if (typeof window === 'undefined') return CODE_MAP_TREE_WIDTH_DEFAULT;
  try {
    return normaliseCodeMapTreeWidth(window.localStorage?.getItem(CODE_MAP_TREE_WIDTH_KEY));
  } catch {
    return CODE_MAP_TREE_WIDTH_DEFAULT;
  }
}

function persistCodeMapTreeWidth(width) {
  codeMapTreeWidth = Math.round(normaliseCodeMapTreeWidth(width));
  try {
    if (typeof window !== 'undefined') window.localStorage?.setItem(CODE_MAP_TREE_WIDTH_KEY, String(codeMapTreeWidth));
  } catch {
    // El divisor sigue funcionando aunque el almacenamiento local no esté disponible.
  }
}

function codeMapTreeWidthLimits(workspace) {
  const styles = window.getComputedStyle(workspace);
  const padding = (Number.parseFloat(styles.paddingLeft) || 0) + (Number.parseFloat(styles.paddingRight) || 0);
  const columnGap = Number.parseFloat(styles.columnGap) || 0;
  const available = workspace.clientWidth - padding - (CODE_MAP_RESIZER_WIDTH + columnGap * 2);
  return {
    min: CODE_MAP_TREE_WIDTH_MIN,
    max: Math.max(CODE_MAP_TREE_WIDTH_MIN, Math.min(CODE_MAP_TREE_WIDTH_MAX, available - CODE_MAP_CANVAS_WIDTH_MIN))
  };
}

function applyCodeMapTreeWidth(workspace, width) {
  if (!workspace) return codeMapTreeWidth;
  const limits = codeMapTreeWidthLimits(workspace);
  const candidate = Number.isFinite(Number(width)) ? Number(width) : codeMapTreeWidth;
  const nextWidth = Math.round(Math.max(limits.min, Math.min(limits.max, candidate)));
  workspace.style.setProperty('--code-map-tree-width', `${nextWidth}px`);
  return nextWidth;
}

function resizeHandleMarkup() {
  return '<button type="button" class="code-map-resizer" data-code-map-resize aria-label="Ajustar el ancho de la lista de ficheros" title="Arrastra para ajustar el ancho de la lista de ficheros"><span aria-hidden="true"></span></button>';
}

function startCodeMapResize(event) {
  const handle = event.target.closest?.('[data-code-map-resize]');
  if (!handle || (event.button !== 0 && event.pointerType !== 'touch')) return;
  const workspace = handle.closest('[data-code-map-workspace]');
  const tree = workspace?.querySelector('.code-map-tree');
  if (!workspace || !tree) return;

  event.preventDefault();
  event.stopPropagation();
  codeMapResizeState = {
    handle,
    pointerId: event.pointerId,
    startX: event.clientX,
    startWidth: tree.getBoundingClientRect().width,
    width: tree.getBoundingClientRect().width,
    workspace
  };
  workspace.classList.add('is-resizing');
  document.body?.classList.add('is-code-map-resizing');
  handle.setPointerCapture?.(event.pointerId);
}

function moveCodeMapResize(event) {
  const resize = codeMapResizeState;
  if (!resize || event.pointerId !== resize.pointerId) return;
  event.preventDefault();
  resize.width = applyCodeMapTreeWidth(resize.workspace, resize.startWidth + event.clientX - resize.startX);
}

function finishCodeMapResize(event) {
  const resize = codeMapResizeState;
  if (!resize || (event?.pointerId != null && event.pointerId !== resize.pointerId)) return;
  persistCodeMapTreeWidth(resize.width);
  resize.workspace.classList.remove('is-resizing');
  document.body?.classList.remove('is-code-map-resizing');
  try { resize.handle.releasePointerCapture?.(resize.pointerId); } catch {}
  codeMapResizeState = null;
}

function bindCodeMapResizeEvents() {
  if (codeMapResizeEventsBound) return;
  codeMapResizeEventsBound = true;
  document.addEventListener('pointermove', moveCodeMapResize);
  document.addEventListener('pointerup', finishCodeMapResize);
  document.addEventListener('pointercancel', finishCodeMapResize);
}

function deriveFolders(files = []) {
  const folders = new Set();
  files.forEach((file) => {
    const parts = String(file.path || '').split('/');
    parts.pop();
    let current = '';
    parts.forEach((part) => {
      current = current ? `${current}/${part}` : part;
      folders.add(current);
    });
  });
  return [...folders].sort((first, second) => first.localeCompare(second));
}

function optionMarkup(value, label, selected) {
  return `<option value="${escapeHtml(value)}"${selected ? ' selected' : ''}>${escapeHtml(label)}</option>`;
}

function scopeDescription(codeMap) {
  if (codeMap.scope === 'entry') {
    return codeMap.entryFile
      ? `Desde ${codeMap.entryFile}, siguiendo sus dependencias locales.`
      : 'Elige un fichero de código como punto de entrada.';
  }
  if (codeMap.scope === 'folder') {
    return codeMap.entryFolder
      ? `Todos los ficheros compatibles de ${codeMap.entryFolder}, incluidos sus subdirectorios.`
      : 'Elige una carpeta del proyecto para construir el diagrama.';
  }
  return 'Todos los ficheros compatibles del proyecto cargado.';
}

function scopeLabel(codeMap) {
  if (codeMap.scope === 'entry') return 'el fichero seleccionado';
  if (codeMap.scope === 'folder') return 'la carpeta seleccionada';
  return 'el proyecto completo';
}

function scopeReady(codeMap) {
  return codeMap.scope === 'project' || (codeMap.scope === 'entry' && Boolean(codeMap.entryFile)) || (codeMap.scope === 'folder' && Boolean(codeMap.entryFolder));
}

function scopeControlsMarkup() {
  const codeMap = codeMapState();
  const scope = ['project', 'entry', 'folder'].includes(codeMap.scope) ? codeMap.scope : 'project';
  const folders = codeMap.folders?.length ? codeMap.folders : deriveFolders(codeMap.files);
  const targetMarkup = scope === 'entry'
    ? [optionMarkup('', 'Selecciona un fichero…', !codeMap.entryFile), ...codeMap.files.map((file) => optionMarkup(file.path, file.path, file.path === codeMap.entryFile))].join('')
    : scope === 'folder'
      ? [optionMarkup('', 'Selecciona una carpeta…', !codeMap.entryFolder), ...folders.map((folder) => optionMarkup(folder, folder, folder === codeMap.entryFolder))].join('')
      : '';
  const disabled = codeMap.loading || codeMap.filesLoading ? ' disabled' : '';
  return `<div class="code-map-config"><label class="code-map-field"><span>Alcance</span><select class="select code-map-select" data-code-map-scope${disabled} aria-label="Alcance del mapa">${optionMarkup('project', 'Proyecto completo', scope === 'project')}${optionMarkup('entry', 'Desde un fichero', scope === 'entry')}${optionMarkup('folder', 'Desde una carpeta', scope === 'folder')}</select></label>${scope !== 'project' ? `<label class="code-map-field"><span>${scope === 'entry' ? 'Fichero de entrada' : 'Carpeta de entrada'}</span><select class="select code-map-select code-map-target" data-code-map-target${disabled} aria-label="${scope === 'entry' ? 'Fichero de entrada' : 'Carpeta de entrada'}">${targetMarkup}</select></label>` : ''}</div>`;
}

function fileById(id) { return codeMapState().result?.files?.find((file) => file.id === id) || null; }
function fileBySymbolId(id) { return codeMapState().result?.files?.find((file) => file.symbols.some((symbol) => symbol.id === id)) || null; }
function selectedFile() {
  const selected = codeMapState().selectedId;
  return selected?.startsWith('symbol:') ? fileBySymbolId(selected) : fileById(selected);
}

function selectedSymbol() {
  const selected = codeMapState().selectedId;
  return selected?.startsWith('symbol:') ? fileBySymbolId(selected)?.symbols.find((symbol) => symbol.id === selected) || null : null;
}

function projectEmptyMarkup() {
  return `<div class="code-map-empty panel"><div class="code-map-empty-icon">⌘</div><h1>Mapa de código</h1><p>Carga un proyecto global para descubrir sus ficheros, símbolos y dependencias locales.</p><button type="button" class="btn btn-primary" data-code-map-go-global>Ir a Buscar</button></div>`;
}

function noFilesMarkup() {
  const codeMap = codeMapState();
  const error = codeMap.error ? `<div class="code-map-error">${escapeHtml(codeMap.error)}</div>` : '';
  const warnings = codeMap.filesWarnings?.length ? `<div class="code-map-warning-list">${codeMap.filesWarnings.slice(0, 8).map((warning) => `<div><strong>${escapeHtml(warning.path || 'Proyecto')}</strong><span>${escapeHtml(warning.message)}</span></div>`).join('')}</div>` : '';
  return `<div class="code-map-empty panel">${error}<div class="code-map-empty-icon">⌁</div><h2>No hay ficheros compatibles</h2><p>Se admiten JavaScript, TypeScript, JSX, TSX, MJS, CJS, HTML y CSS. Se excluyen automáticamente node_modules, .git, dist, build, coverage y cachés.</p>${warnings}<button type="button" class="btn btn-secondary" data-code-map-refresh-files>Volver a descubrir ficheros</button></div>`;
}

function toolbarMarkup() {
  const codeMap = codeMapState();
  const loading = codeMap.loading;
  const ready = scopeReady(codeMap);
  const disabled = loading || !ready ? 'disabled' : '';
  return `<div class="code-map-toolbar"><div class="code-map-title-wrap"><h1>Mapa de código</h1><p>${escapeHtml(scopeDescription(codeMap))}</p></div>${scopeControlsMarkup()}<div class="code-map-actions"><button type="button" class="btn ${loading ? 'btn-secondary' : 'btn-primary'} code-map-generate" data-code-map-generate ${disabled}>${loading ? 'Analizando…' : codeMap.result ? '↻ Actualizar mapa' : 'Generar mapa'}</button>${loading ? '<button type="button" class="btn btn-danger" data-code-map-cancel>Cancelar</button>' : ''}</div></div>`;
}

function beforeMapMarkup() {
  const codeMap = codeMapState();
  return `<div class="code-map-before panel"><div class="code-map-empty-icon">⌁</div><div><h2>Listo para generar</h2><p><strong>${codeMap.files.length} fichero${codeMap.files.length === 1 ? '' : 's'} compatible${codeMap.files.length === 1 ? '' : 's'}</strong> detectado${codeMap.files.length === 1 ? '' : 's'}. ${escapeHtml(scopeDescription(codeMap))}</p></div></div>`;
}

function staleMarkup() {
  return codeMapState().stale ? '<div class="code-map-stale panel">La selección o los ficheros del proyecto han cambiado. Genera de nuevo el mapa para actualizar el diagrama.</div>' : '';
}

function folderMarkup() {
  const codeMap = codeMapState();
  const files = codeMap.result?.files || [];
  if (!files.length) return '';
  const folders = new Map();
  files.forEach((file) => {
    const folder = file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : 'raíz';
    if (!folders.has(folder)) folders.set(folder, []);
    folders.get(folder).push(file);
  });
  return `<aside class="code-map-tree panel"><div class="code-map-tree-head"><strong>Ficheros</strong><span>${files.length}</span></div><div class="code-map-tree-list">${[...folders.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([folder, entries]) => `<div class="code-map-tree-folder"><span class="code-map-tree-folder-name">${escapeHtml(folder)}</span>${entries.sort((a, b) => a.path.localeCompare(b.path)).map((file) => `<button type="button" class="code-map-tree-file${selectedFile()?.id === file.id ? ' is-selected' : ''}" data-code-map-tree-file="${escapeHtml(file.id)}"><span class="code-map-tree-dot code-map-dot-${escapeHtml(file.language)}"></span><span title="${escapeHtml(file.path)}">${escapeHtml(file.path.split('/').pop())}</span></button>`).join('')}</div>`).join('')}</div></aside>`;
}

function relationEndpointLabel(id, result) {
  if (!id) return 'No resuelto';
  const file = result.files.find((candidate) => candidate.id === id);
  if (file) return file.path;
  for (const candidate of result.files) {
    const symbol = candidate.symbols.find((item) => item.id === id);
    if (symbol) return `${candidate.path} · ${symbol.name}`;
  }
  const external = result.externalPackages?.find((item) => item.id === id);
  return external ? external.name : id;
}

function detailMarkup() {
  const codeMap = codeMapState();
  const result = codeMap.result;
  if (!result) return '<aside class="code-map-detail panel"><div class="code-map-detail-empty">Selecciona un elemento después de generar el mapa.</div></aside>';
  if (codeMap.selectedRelationId) {
    const relation = result.relations.find((item) => item.id === codeMap.selectedRelationId);
    if (relation) {
      const sourceFile = relation.from?.startsWith('symbol:') ? fileBySymbolId(relation.from) : fileById(relation.from);
      return `<aside class="code-map-detail panel"><div class="code-map-detail-head"><span class="code-map-detail-kicker">RELACIÓN</span><h2>${escapeHtml(relationLabel(relation.kind))}</h2></div><dl class="code-map-detail-list"><div><dt>Origen</dt><dd>${escapeHtml(relationEndpointLabel(relation.from, result))}</dd></div><div><dt>Destino</dt><dd>${escapeHtml(relationEndpointLabel(relation.to, result))}</dd></div><div><dt>Estado</dt><dd class="${relation.resolved ? 'is-ok' : 'is-warning'}">${relation.resolved ? 'Resuelta' : 'No resuelta'}</dd></div>${relation.request ? `<div><dt>Referencia</dt><dd><code>${escapeHtml(relation.request)}</code></dd></div>` : ''}${relation.line ? `<div><dt>Línea</dt><dd>${escapeHtml(relation.line)}</dd></div>` : ''}</dl><div class="code-map-detail-actions">${sourceFile ? `<button type="button" class="btn btn-primary btn-small" data-code-map-open="${escapeHtml(sourceFile.path)}" data-code-map-line="${escapeHtml(relation.line || 1)}">Abrir origen</button>` : ''}</div></aside>`;
    }
  }
  const symbol = selectedSymbol();
  const file = selectedFile();
  if (!file) return '<aside class="code-map-detail panel"><div class="code-map-detail-empty">Selecciona un fichero, símbolo o conexión.</div></aside>';
  if (symbol) {
    const startLine = symbol.range?.startLine || 1;
    const endLine = symbol.range?.endLine || startLine;
    return `<aside class="code-map-detail panel"><div class="code-map-detail-head"><span class="code-map-detail-kicker">SÍMBOLO · ${escapeHtml(symbol.kind)}</span><h2>${escapeHtml(symbol.name)}</h2></div><dl class="code-map-detail-list"><div><dt>Fichero</dt><dd>${escapeHtml(file.path)}</dd></div><div><dt>Línea</dt><dd>${escapeHtml(`${startLine}${endLine !== startLine ? `–${endLine}` : ''}`)}</dd></div><div><dt>Exportado</dt><dd>${symbol.exported ? 'Sí' : 'No'}</dd></div>${symbol.imported ? `<div><dt>Importa</dt><dd><code>${escapeHtml(symbol.imported)}</code></dd></div>` : ''}</dl><div class="code-map-detail-actions"><button type="button" class="btn btn-primary btn-small" data-code-map-open="${escapeHtml(file.path)}" data-code-map-line="${escapeHtml(startLine)}" data-code-map-end-line="${escapeHtml(endLine)}" data-code-map-symbol-label="${escapeHtml(symbol.name)}">Abrir código</button></div></aside>`;
  }
  return `<aside class="code-map-detail panel"><div class="code-map-detail-head"><span class="code-map-detail-kicker">FICHERO · ${escapeHtml(languageLabel(file.language))}</span><h2 title="${escapeHtml(file.path)}">${escapeHtml(file.path.split('/').pop())}</h2><p>${escapeHtml(file.path)}</p></div><dl class="code-map-detail-list"><div><dt>Tamaño</dt><dd>${escapeHtml(formatBytes(file.size))}</dd></div><div><dt>Símbolos</dt><dd>${escapeHtml(file.symbols.length)}</dd></div><div><dt>Conexiones</dt><dd>${escapeHtml(result.relations.filter((relation) => relation.from === file.id || relation.to === file.id).length)}</dd></div></dl>${file.warnings?.length ? `<div class="code-map-detail-warnings">${file.warnings.map((warning) => `<div><strong>Línea ${escapeHtml(warning.line || 1)}</strong><span>${escapeHtml(warning.message)}</span></div>`).join('')}</div>` : ''}<div class="code-map-detail-actions"><button type="button" class="btn btn-primary btn-small" data-code-map-open="${escapeHtml(file.path)}">Abrir código</button></div></aside>`;
}

function normaliseCodeRange(range, lineCount) {
  const start = Number(range?.startLine);
  const end = Number(range?.endLine);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  const startLine = Math.max(1, Math.min(lineCount, Math.floor(start)));
  const endLine = Math.max(startLine, Math.min(lineCount, Math.floor(end)));
  return { startLine, endLine };
}

function modalMarkup(file, line, range = null, symbolName = '') {
  const lines = String(file.content || '').split(/\r?\n/);
  const selectedRange = normaliseCodeRange(range, lines.length);
  const visibleLines = selectedRange
    ? lines.slice(selectedRange.startLine - 1, selectedRange.endLine).map((content, index) => ({ content, lineNumber: selectedRange.startLine + index }))
    : lines.map((content, index) => ({ content, lineNumber: index + 1 }));
  const targetLine = Number(line) || selectedRange?.startLine || file.line || 0;
  const numberWidth = String(selectedRange?.endLine || lines.length).length;
  const heading = symbolName ? `${file.path} · ${symbolName}` : file.path;
  const scope = selectedRange ? ` · líneas ${selectedRange.startLine}–${selectedRange.endLine}` : '';
  return `<div id="code-map-code-modal" class="modal-backdrop"><div class="modal code-map-code-modal" role="dialog" aria-modal="true" aria-labelledby="code-map-code-title"><div class="modal-head"><div><h2 id="code-map-code-title">${escapeHtml(heading)}</h2><p>${escapeHtml(languageLabel(file.language))} · ${escapeHtml(file.size)} bytes${scope}</p></div><button type="button" class="modal-close" data-code-map-close-modal aria-label="Cerrar">×</button></div><div class="code-map-code-body"><pre class="code-map-code-view">${visibleLines.map(({ content, lineNumber }) => `<span class="code-map-code-line${lineNumber === targetLine ? ' is-target' : ''}" data-line="${lineNumber}"><b>${String(lineNumber).padStart(numberWidth, ' ')}</b>${escapeHtml(content) || ' '}</span>`).join('')}</pre></div></div></div>`;
}

function renderGraphAndDetails() {
  const codeMap = codeMapState();
  const graph = $('#code-map-graph');
  if (graph && codeMap.result) renderCodeMapGraph(graph, {
    result: codeMap.result,
    filters: codeMap.filters,
    expanded: codeMap.expanded,
    groupByFolder: codeMap.groupByFolder,
    selectedId: selectedFile()?.id || null,
    selectedSymbolId: codeMap.selectedId?.startsWith('symbol:') ? codeMap.selectedId : null,
    selectedRelationId: codeMap.selectedRelationId,
    depth: codeMap.depth,
    zoom: codeMap.zoom
  });
  const minimap = $('#code-map-minimap-wrap');
  if (minimap && codeMap.result) minimap.innerHTML = minimapMarkup(codeMap.result, codeMap.filters, codeMap.expanded, codeMap.groupByFolder);
}

export function renderCodeMap() {
  const codeMap = codeMapState();
  if (!state.globalProject) {
    $('#view-code-map').innerHTML = projectEmptyMarkup();
    bindCodeMapEvents($('#view-code-map'));
    return;
  }
  if (!codeMap.filesLoading && !codeMap.files.length && !codeMap.error) loadCodeMapFiles();
  if (codeMap.filesLoading && !codeMap.files.length) {
    $('#view-code-map').innerHTML = '<div class="code-map-loading panel"><span class="spinner"></span><strong>Descubriendo ficheros compatibles…</strong></div>';
    return;
  }
  if (!codeMap.files.length) {
    $('#view-code-map').innerHTML = noFilesMarkup();
    bindCodeMapEvents($('#view-code-map'));
    return;
  }
  const treeMarkup = codeMap.result ? folderMarkup() : '';
  const workspaceClass = treeMarkup ? 'code-map-workspace' : 'code-map-workspace code-map-workspace-single';
  $('#view-code-map').innerHTML = `<div class="code-map-shell">${toolbarMarkup()}${codeMap.error ? `<div class="code-map-error panel">${escapeHtml(codeMap.error)}</div>` : ''}${staleMarkup()}${codeMap.loading ? '<div class="code-map-progress panel"><span class="spinner"></span><span>Analizando el alcance seleccionado sin ejecutar su código…</span></div>' : ''}${codeMap.result ? `<div id="code-map-workspace" class="${workspaceClass}" data-code-map-workspace style="--code-map-tree-width: ${Math.round(codeMapTreeWidth)}px">${treeMarkup}${treeMarkup ? resizeHandleMarkup() : ''}<section class="code-map-canvas-wrap panel"><div class="code-map-canvas-toolbar"><div><button type="button" class="btn btn-secondary btn-small" data-code-map-zoom="out" aria-label="Alejar">−</button><span class="code-map-zoom-value">${Math.round(codeMap.zoom * 100)}%</span><button type="button" class="btn btn-secondary btn-small" data-code-map-zoom="in" aria-label="Acercar">＋</button><button type="button" class="btn btn-secondary btn-small" data-code-map-fit>Ajustar</button></div></div><div id="code-map-graph" class="code-map-graph" tabindex="0"></div><div id="code-map-minimap-wrap">${minimapMarkup(codeMap.result, codeMap.filters, codeMap.expanded, codeMap.groupByFolder)}</div></section></div>` : beforeMapMarkup()}</div>`;
  const workspace = $('#code-map-workspace');
  const resizeHandle = workspace?.querySelector('[data-code-map-resize]');
  if (workspace && resizeHandle && window.getComputedStyle(resizeHandle).display !== 'none') {
    codeMapTreeWidth = applyCodeMapTreeWidth(workspace, codeMapTreeWidth);
  }
  bindCodeMapEvents($('#view-code-map'));
  if (codeMap.result) renderGraphAndDetails();
}

async function loadCodeMapFiles() {
  const codeMap = codeMapState();
  if (codeMap.filesLoading || !state.globalProject) return;
  const requestId = ++filesRequestId;
  codeMap.filesLoading = true;
  codeMap.error = '';
  renderCodeMap();
  try {
    const result = await api(`/code-map/files?maxFiles=${encodeURIComponent(codeMap.maxFiles)}&maxFileBytes=${encodeURIComponent(codeMap.maxFileBytes)}`);
    if (requestId !== filesRequestId) return;
    if (result.loaded === false) throw new Error('No hay un proyecto global cargado');
    const previousFingerprint = codeMap.filesFingerprint;
    codeMap.files = result.files || [];
    codeMap.folders = result.folders || deriveFolders(codeMap.files);
    codeMap.filesWarnings = result.warnings || [];
    codeMap.filesFingerprint = result.project?.fingerprint || '';
    codeMap.stale = Boolean(codeMap.result && (codeMap.stale || (previousFingerprint && previousFingerprint !== codeMap.filesFingerprint)));
    if (codeMap.entryFile && !codeMap.files.some((file) => file.path === codeMap.entryFile)) codeMap.entryFile = '';
    if (codeMap.entryFolder && !codeMap.folders.includes(codeMap.entryFolder)) codeMap.entryFolder = '';
  } catch (error) {
    if (requestId === filesRequestId) codeMap.error = error.message;
  } finally {
    if (requestId === filesRequestId) {
      codeMap.filesLoading = false;
      renderCodeMap();
    }
  }
}

async function generateCodeMap() {
  const codeMap = codeMapState();
  if (codeMap.loading) return;
  const scope = ['project', 'entry', 'folder'].includes(codeMap.scope) ? codeMap.scope : 'project';
  if (scope === 'entry' && !codeMap.entryFile) {
    codeMap.error = 'Selecciona un fichero de código antes de generar el mapa';
    renderCodeMap();
    return;
  }
  if (scope === 'folder' && !codeMap.entryFolder) {
    codeMap.error = 'Selecciona una carpeta antes de generar el mapa';
    renderCodeMap();
    return;
  }
  const requestId = ++analysisRequestId;
  const controller = new AbortController();
  analysisController = controller;
  codeMap.loading = true;
  codeMap.error = '';
  codeMap.selectedId = null;
  codeMap.selectedRelationId = null;
  renderCodeMap();
  try {
    const result = await api('/code-map/analyze', {
      method: 'POST',
      signal: controller.signal,
      body: JSON.stringify({
        scope,
        entryFile: scope === 'entry' ? codeMap.entryFile : '',
        entryFolder: scope === 'folder' ? codeMap.entryFolder : '',
        includeExternalPackages: codeMap.includeExternalPackages,
        excludes: codeMap.excludes,
        maxFiles: codeMap.maxFiles,
        maxFileBytes: codeMap.maxFileBytes
      })
    });
    if (requestId !== analysisRequestId) return;
    codeMap.result = result;
    codeMap.stale = false;
    codeMap.error = '';
    showToast(`Mapa generado desde ${scopeLabel(codeMap)}: ${result.summary.files} fichero${result.summary.files === 1 ? '' : 's'}`);
  } catch (error) {
    if (requestId === analysisRequestId && error.name !== 'AbortError') codeMap.error = error.message;
  } finally {
    if (requestId === analysisRequestId) {
      codeMap.loading = false;
      analysisController = null;
      renderCodeMap();
    }
  }
}

async function openCode(path, line = null, range = null, symbolName = '') {
  try {
    const query = new URLSearchParams({ path });
    if (line) query.set('line', line);
    const file = await api(`/code-map/file?${query}`);
    $('#modal-root').innerHTML = modalMarkup(file, line, range, symbolName);
    const modal = $('#code-map-code-modal');
    modal?.addEventListener('click', (event) => {
      if (event.target.closest?.('[data-code-map-close-modal]')) closeModal();
    });
    modal?.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeModal();
    });
    const target = $('#modal-root .code-map-code-line.is-target');
    target?.scrollIntoView({ block: 'center' });
    $('#modal-root [data-code-map-close-modal]')?.focus();
  } catch (error) { showToast(error.message, true); }
}

async function openFileCode(fileId, line = null) {
  const file = fileById(fileId);
  if (file) await openCode(file.path, line);
}

async function openSymbolCode(symbolId) {
  const file = fileBySymbolId(symbolId);
  const symbol = file?.symbols.find((item) => item.id === symbolId);
  if (file) await openCode(file.path, symbol?.range?.startLine || 1, symbol?.range, symbol?.name || '');
}

function closeModal() { $('#code-map-code-modal')?.remove(); }

function selectFile(id) {
  const codeMap = codeMapState();
  codeMap.selectedId = id;
  codeMap.selectedRelationId = null;
  codeMap.expanded[id] = true;
  renderGraphAndDetails();
}

function updateAnalysisScope(value) {
  const codeMap = codeMapState();
  if (codeMap.loading) return;
  const scope = ['project', 'entry', 'folder'].includes(value) ? value : 'project';
  codeMap.scope = scope;
  if (scope === 'project') {
    codeMap.entryFile = '';
    codeMap.entryFolder = '';
  } else if (scope === 'entry') {
    codeMap.entryFolder = '';
  } else {
    codeMap.entryFile = '';
  }
  codeMap.error = '';
  codeMap.stale = Boolean(codeMap.result);
  renderCodeMap();
}

function updateAnalysisTarget(value) {
  const codeMap = codeMapState();
  if (codeMap.loading) return;
  if (codeMap.scope === 'entry') codeMap.entryFile = value;
  if (codeMap.scope === 'folder') codeMap.entryFolder = value;
  codeMap.error = '';
  codeMap.stale = Boolean(codeMap.result);
  renderCodeMap();
}

function bindCodeMapEvents(container) {
  if (!container) return;
  bindCodeMapResizeEvents();
  if (container.dataset.codeMapBound !== 'true') {
    container.dataset.codeMapBound = 'true';
    container.addEventListener('pointerdown', startCodeMapResize);
    container.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-code-map-go-global], [data-code-map-refresh-files], [data-code-map-generate], [data-code-map-cancel], [data-code-map-file], [data-code-map-file-select], [data-code-map-tree-file], [data-code-map-toggle], [data-code-map-symbol], [data-code-map-relation], [data-code-map-open], [data-code-map-zoom], [data-code-map-fit], [data-code-map-close-modal]');
    if (!target) return;
    if (target.matches('[data-code-map-go-global]')) { navigateToView('global-search'); return; }
    if (target.matches('[data-code-map-refresh-files]')) { codeMapState().files = []; codeMapState().folders = []; await loadCodeMapFiles(); return; }
    if (target.matches('[data-code-map-generate]')) { await generateCodeMap(); return; }
    if (target.matches('[data-code-map-cancel]')) { analysisController?.abort(); return; }
    if (target.matches('[data-code-map-toggle]')) { const id = target.dataset.codeMapToggle; codeMapState().expanded[id] = !codeMapState().expanded[id]; renderGraphAndDetails(); return; }
    if (target.matches('[data-code-map-file]')) { selectFile(target.dataset.codeMapFile); await openFileCode(target.dataset.codeMapFile); return; }
    if (target.matches('[data-code-map-file-select], [data-code-map-tree-file]')) { const fileId = target.dataset.codeMapFileSelect || target.dataset.codeMapTreeFile; selectFile(fileId); await openFileCode(fileId); return; }
    if (target.matches('[data-code-map-symbol]')) { codeMapState().selectedId = target.dataset.codeMapSymbol; codeMapState().selectedRelationId = null; renderGraphAndDetails(); await openSymbolCode(target.dataset.codeMapSymbol); return; }
    if (target.matches('[data-code-map-relation]')) { codeMapState().selectedRelationId = target.dataset.codeMapRelation; codeMapState().selectedId = null; renderGraphAndDetails(); return; }
    if (target.matches('[data-code-map-open]')) {
      const range = target.dataset.codeMapEndLine
        ? { startLine: target.dataset.codeMapLine, endLine: target.dataset.codeMapEndLine }
        : null;
      await openCode(target.dataset.codeMapOpen, target.dataset.codeMapLine, range, target.dataset.codeMapSymbolLabel || '');
      return;
    }
    if (target.matches('[data-code-map-close-modal]')) { closeModal(); return; }
    if (target.matches('[data-code-map-zoom]')) { codeMapState().zoom = Math.max(.35, Math.min(2, codeMapState().zoom + (target.dataset.codeMapZoom === 'in' ? .1 : -.1))); renderGraphAndDetails(); return; }
    if (target.matches('[data-code-map-fit]')) { codeMapState().zoom = 1; renderGraphAndDetails(); $('#code-map-graph')?.scrollTo({ left: 0, top: 0, behavior: 'smooth' }); }
    });
    container.addEventListener('change', (event) => {
      const target = event.target.closest('[data-code-map-scope], [data-code-map-target]');
      if (!target) return;
      if (target.matches('[data-code-map-scope]')) updateAnalysisScope(target.value);
      if (target.matches('[data-code-map-target]')) updateAnalysisTarget(target.value);
    });
    container.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && $('#code-map-code-modal')) { closeModal(); return; }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target.closest('[data-code-map-file], [data-code-map-relation]');
    if (!target) return;
    event.preventDefault();
    if (target.dataset.codeMapFile) selectFile(target.dataset.codeMapFile);
    if (target.dataset.codeMapRelation) { codeMapState().selectedRelationId = target.dataset.codeMapRelation; codeMapState().selectedId = null; renderGraphAndDetails(); }
    });
  }
}

export { loadCodeMapFiles, generateCodeMap };
