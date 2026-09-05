import { $, escapeHtml } from '../core/dom.js';
import { sectionIconMarkup } from '../core/section-icons.js';
import { currentDiagramFontScale } from '../core/diagram-settings.js';
import { state } from '../core/state.js';
import { showToast } from '../ui/notifications.js';
import { bindModalClose, closeModal } from '../ui/modals.js';
import { parseDiagramText, serializeDiagram } from './diagram-language.mjs';

const STORAGE_KEY = 'nexusdata.diagrams.v1';
const BOARD_WIDTH = 1400;
const BOARD_HEIGHT = 900;
const NODE_WIDTH = 190;
const NODE_HEIGHT = 88;
const NODE_MIN_WIDTH = 120;
const NODE_MIN_HEIGHT = 64;
const NODE_MAX_WIDTH = 420;
const NODE_MAX_HEIGHT = 280;
const NODE_DESCRIPTION_MIN_HEIGHT = 176;
const NODE_DESCRIPTION_MAX_LENGTH = 2000;
const NODE_MARGIN = 20;
const AUTO_LAYOUT_COLUMNS = 4;
const AUTO_LAYOUT_COLUMN_GAP = 140;
const AUTO_LAYOUT_ROW_GAP = 120;
const ARROW_INSET = 0;
const DIAGRAM_ZOOM_MIN = 0.2;
const DIAGRAM_ZOOM_MAX = 3;
const DIAGRAM_ZOOM_SENSITIVITY = 0.0015;
const DIAGRAM_ZOOM_STEP = 1.15;
const DIAGRAM_GRID_SIZE = 24;
const DIAGRAM_IMAGE_SCALE = 2;
const HISTORY_LIMIT = 100;
const NODE_TYPES = Object.freeze({
  start: 'Inicio',
  step: 'Paso',
  decision: 'Decisión',
  end: 'Fin'
});
const EDGE_DIRECTIONS = Object.freeze({
  none: 'Línea simple',
  forward: 'Hacia el destino',
  backward: 'Hacia el origen'
});
const EDGE_COLOR_KEYS = Object.freeze(['blue', 'amber', 'purple', 'cyan', 'green', 'red']);
const PORTS = Object.freeze({
  top: { label: 'arriba', x: 0.5, y: 0, dx: 0, dy: -1 },
  right: { label: 'derecha', x: 1, y: 0.5, dx: 1, dy: 0 },
  bottom: { label: 'abajo', x: 0.5, y: 1, dx: 0, dy: 1 },
  left: { label: 'izquierda', x: 0, y: 0.5, dx: -1, dy: 0 }
});

let diagrams = loadDiagrams();
let activeDiagramId = diagrams[0]?.id || null;
let selection = { type: '', id: '' };
let connectMode = false;
let connectionStart = null;
let connectionAnchorNodeId = '';
let connectionDrag = null;
let suppressedPortKeys = new Set();
let dragState = null;
let resizeState = null;
let panState = null;
let lastDraggedNode = { id: '', timestamp: 0 };
let focusNodeId = null;
let focusNodeDescriptionId = null;
let contextMenuEdgeId = '';
let contextMenuNodeId = '';
let contextMenuCanvasPoint = null;
let edgeLabelEditor = null;
let undoStack = [];
let redoStack = [];
let diagramResizeObserver = null;
let diagramKeyboardBound = false;
let diagramViewport = {
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  initialized: false,
  userZoomed: false
};
const pendingTextHistory = new WeakMap();

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function nodeWidth(node) {
  const value = Number(node?.width);
  return clamp(Number.isFinite(value) ? value : NODE_WIDTH, NODE_MIN_WIDTH, NODE_MAX_WIDTH);
}

function nodeHeight(node) {
  const value = Number(node?.height);
  return clamp(Number.isFinite(value) ? value : NODE_HEIGHT, NODE_MIN_HEIGHT, NODE_MAX_HEIGHT);
}

function hasNodeDescription(node) {
  return Boolean(node && Object.prototype.hasOwnProperty.call(node, 'description'));
}

function validNodeType(type) {
  return Object.prototype.hasOwnProperty.call(NODE_TYPES, type) ? type : 'step';
}

function validEdgeDirection(direction) {
  return Object.prototype.hasOwnProperty.call(EDGE_DIRECTIONS, direction) ? direction : 'forward';
}

function validEdgeColor(color) {
  return typeof color === 'string' && EDGE_COLOR_KEYS.includes(color) ? color : '';
}

function edgeColorForIndex(index) {
  const safeIndex = Number.isFinite(Number(index)) ? Math.max(0, Number(index)) : 0;
  return EDGE_COLOR_KEYS[safeIndex % EDGE_COLOR_KEYS.length];
}

function nextEdgeColor(diagram) {
  const usedColors = new Set(diagram.edges.map((edge) => validEdgeColor(edge.color)).filter(Boolean));
  return EDGE_COLOR_KEYS.find((color) => !usedColors.has(color)) || edgeColorForIndex(diagram.edges.length);
}

function sourceIdValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function loadedSourceIds() {
  return new Set(
    (Array.isArray(state.sources) ? state.sources : [])
      .filter((source) => source && typeof source === 'object' && source.config?.role !== 'common-paths')
      .map((source) => sourceIdValue(source.id))
      .filter(Boolean)
  );
}

function hasLoadedSources() {
  return loadedSourceIds().size > 0;
}

function diagramBelongsToLoadedSource(diagram, sourceIds = loadedSourceIds()) {
  // Los diagramas antiguos sin sourceId no se pueden atribuir con seguridad a una Fuente.
  const sourceId = sourceIdValue(diagram?.sourceId);
  return Boolean(sourceId && sourceIds.has(sourceId));
}

function visibleDiagrams() {
  const sourceIds = loadedSourceIds();
  return diagrams.filter((diagram) => diagramBelongsToLoadedSource(diagram, sourceIds));
}

function preferredSourceId() {
  const sourceIds = loadedSourceIds();
  const selected = diagrams.find((diagram) => diagram.id === activeDiagramId);
  const selectedSourceId = sourceIdValue(selected?.sourceId);
  if (selectedSourceId && sourceIds.has(selectedSourceId)) return selectedSourceId;
  return sourceIds.values().next().value || null;
}

function createDiagram(title = 'Nuevo diagrama', sourceId = null) {
  return { id: makeId('diagram'), title, sourceId: sourceIdValue(sourceId), nodes: [], edges: [] };
}

function duplicateDiagramTitle(title) {
  const base = String(title || 'Diagrama').trim() || 'Diagrama';
  let copyNumber = 1;
  while (true) {
    const suffix = copyNumber === 1 ? ' (copia)' : ` (copia ${copyNumber})`;
    const candidate = `${base.slice(0, Math.max(1, 120 - suffix.length))}${suffix}`;
    if (!diagrams.some((diagram) => diagram.title === candidate)) return candidate;
    copyNumber += 1;
  }
}

function defaultNodePosition(index) {
  return {
    x: 100 + (index % AUTO_LAYOUT_COLUMNS) * (NODE_WIDTH + AUTO_LAYOUT_COLUMN_GAP),
    y: 100 + Math.floor(index / AUTO_LAYOUT_COLUMNS) * (NODE_HEIGHT + AUTO_LAYOUT_ROW_GAP)
  };
}

function normaliseNode(raw, index, usedIds) {
  const requestedId = typeof raw?.id === 'string' && raw.id ? raw.id : makeId('node');
  const id = usedIds.has(requestedId) ? makeId('node') : requestedId;
  const fallbackPosition = defaultNodePosition(index);
  const width = nodeWidth(raw);
  const hasDescription = hasNodeDescription(raw);
  const height = hasDescription
    ? Math.max(nodeHeight(raw), NODE_DESCRIPTION_MIN_HEIGHT)
    : nodeHeight(raw);
  usedIds.add(id);
  const node = {
    id,
    label: typeof raw?.label === 'string' && raw.label.trim() ? raw.label.slice(0, 160) : `Paso ${index + 1}`,
    type: validNodeType(raw?.type),
    x: clamp(Number.isFinite(Number(raw?.x)) ? Number(raw.x) : fallbackPosition.x, NODE_MARGIN, BOARD_WIDTH - width - NODE_MARGIN),
    y: clamp(Number.isFinite(Number(raw?.y)) ? Number(raw.y) : fallbackPosition.y, NODE_MARGIN, BOARD_HEIGHT - height - NODE_MARGIN),
    width,
    height
  };
  if (hasDescription) node.description = String(raw.description ?? '').slice(0, NODE_DESCRIPTION_MAX_LENGTH);
  return node;
}

function normaliseEdge(raw, index, nodeIds, usedIds) {
  const source = typeof raw?.source === 'string' ? { nodeId: raw.source, port: 'right' } : raw?.source || {};
  const target = typeof raw?.target === 'string' ? { nodeId: raw.target, port: 'left' } : raw?.target || {};
  if (!nodeIds.has(source.nodeId) || !nodeIds.has(target.nodeId)) return null;
  const requestedId = typeof raw?.id === 'string' && raw.id ? raw.id : makeId('edge');
  const id = usedIds.has(requestedId) ? makeId('edge') : requestedId;
  usedIds.add(id);
  return {
    id,
    source: { nodeId: source.nodeId, port: PORTS[source.port] ? source.port : 'right' },
    target: { nodeId: target.nodeId, port: PORTS[target.port] ? target.port : 'left' },
    label: typeof raw?.label === 'string' ? raw.label.slice(0, 120) : '',
    direction: validEdgeDirection(raw?.direction),
    color: validEdgeColor(raw?.color) || edgeColorForIndex(index)
  };
}

function normaliseDiagram(raw, index) {
  const nodeIds = new Set();
  const edgeIds = new Set();
  const nodes = (Array.isArray(raw?.nodes) ? raw.nodes : []).map((node, nodeIndex) => normaliseNode(node, nodeIndex, nodeIds));
  const edges = (Array.isArray(raw?.edges) ? raw.edges : [])
    .map((edge, edgeIndex) => normaliseEdge(edge, edgeIndex, nodeIds, edgeIds))
    .filter(Boolean);
  return {
    id: typeof raw?.id === 'string' && raw.id ? raw.id : makeId('diagram'),
    title: typeof raw?.title === 'string' && raw.title.trim() ? raw.title.slice(0, 120) : `Diagrama ${index + 1}`,
    sourceId: sourceIdValue(raw?.sourceId),
    nodes,
    edges
  };
}

function loadDiagrams() {
  const fallback = [createDiagram('Flujo principal')];
  if (typeof window === 'undefined' || !window.localStorage) return fallback;
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
    if (!Array.isArray(stored) || !stored.length) return fallback;
    return stored.map(normaliseDiagram);
  } catch {
    return fallback;
  }
}

function persistDiagrams() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(diagrams));
  } catch {
    // La edición continúa disponible aunque el almacenamiento local no esté disponible.
  }
}

function resetDiagramViewState() {
  diagramResizeObserver?.disconnect();
  diagramResizeObserver = null;
  resetDiagramInteraction();
  focusNodeId = null;
  focusNodeDescriptionId = null;
  diagramViewport = {
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    initialized: false,
    userZoomed: false
  };
}

function renderSourcesRequired(root) {
  if (hasLoadedSources()) return false;
  resetDiagramViewState();
  root.innerHTML = '<div class="diagram-source-required" role="status"><strong>Sin fuentes cargadas</strong><span>Carga una fuente desde la sección Fuentes para abrir y editar diagramas.</span></div>';
  return true;
}

export function getDiagramWorkspaceState() {
  return {
    diagrams: cloneValue(diagrams),
    activeDiagramId
  };
}

export function restoreDiagramWorkspaceState(workspaceState) {
  const rawDiagrams = Array.isArray(workspaceState) ? workspaceState : workspaceState?.diagrams;
  if (!Array.isArray(rawDiagrams)) return false;
  const restored = rawDiagrams.map(normaliseDiagram).filter(Boolean);
  diagrams = restored;
  const requestedActiveId = workspaceState?.activeDiagramId;
  activeDiagramId = diagrams.some((diagram) => diagram.id === requestedActiveId)
    ? requestedActiveId
    : visibleDiagrams()[0]?.id || null;
  undoStack = [];
  redoStack = [];
  resetDiagramInteraction();
  persistDiagrams();
  if (typeof document !== 'undefined' && document.querySelector('#view-diagrams')?.classList.contains('active')) renderDiagrams();
  return true;
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const helper = document.createElement('textarea');
  helper.value = text;
  helper.setAttribute('readonly', '');
  helper.style.position = 'fixed';
  helper.style.opacity = '0';
  document.body.appendChild(helper);
  helper.select();
  const copied = document.execCommand('copy');
  helper.remove();
  if (!copied) throw new Error('El portapapeles no está disponible');
}

function fileNameFromPath(filePath) {
  return String(filePath || '').split(/[\\/]/).filter(Boolean).pop() || 'diagrama.nxd';
}

async function exportDiagramText(text, button = null) {
  const originalText = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = 'Exportando…';
  }
  try {
    if (typeof window.nexusData?.saveDiagramFile !== 'function') throw new Error('La exportación de diagramas no está disponible');
    const savedPath = await window.nexusData.saveDiagramFile({ content: text, format: 'nxd' });
    if (savedPath) showToast(`Diagrama exportado: ${fileNameFromPath(savedPath)}`);
  } catch (error) {
    showToast(error.message || 'No se pudo exportar el diagrama', true);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

function applyDiagramText(text, { successMessage = 'Diagrama generado desde texto', sourceId = null } = {}) {
  const parsed = parseDiagramText(text);
  const current = activeDiagram();
  const before = historySnapshot();
  const index = Math.max(0, diagrams.findIndex((diagram) => diagram.id === current.id));
  const next = normaliseDiagram({
    ...parsed,
    id: current.id,
    sourceId: sourceIdValue(sourceId) || sourceIdValue(current.sourceId) || preferredSourceId()
  }, index);
  diagrams = diagrams.some((diagram) => diagram.id === current.id)
    ? diagrams.map((diagram) => diagram.id === current.id ? next : diagram)
    : [...diagrams, next];
  activeDiagramId = next.id;
  resetDiagramInteraction();
  recordHistory(before);
  persistDiagrams();
  renderDiagrams();
  if (successMessage) showToast(successMessage);
}

export function openDiagramDocument(diagramDocument) {
  if (!diagramDocument || typeof diagramDocument.content !== 'string') {
    throw new Error('El contenido del diagrama no es válido');
  }
  applyDiagramText(diagramDocument.content, {
    successMessage: 'Diagrama abierto visualmente',
    sourceId: diagramDocument.sourceId
  });
  closeModal();
}

function setDiagramCodeError(node, message = '') {
  if (!node) return;
  node.textContent = message;
  node.hidden = !message;
}

function openDiagramCodeModal(initialText = serializeDiagram(activeDiagram()), sourcePath = '') {
  const sourceName = sourcePath ? fileNameFromPath(sourcePath) : 'Diagrama activo';
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><div class="modal diagram-code-modal" role="dialog" aria-modal="true" aria-labelledby="diagram-code-title"><div class="modal-head"><div><h2 id="diagram-code-title">Código del diagrama</h2><p>Escribe o revisa el lenguaje textual y genera el diagrama seleccionado.</p></div><button class="modal-close" data-close-modal aria-label="Cerrar">×</button></div><div class="modal-body diagram-code-body"><div class="diagram-code-source">Origen: <strong id="diagram-code-source">${escapeHtml(sourceName)}</strong></div><textarea id="diagram-code-editor" class="diagram-code-editor" aria-label="Código textual del diagrama" spellcheck="false">${escapeHtml(initialText)}</textarea><div id="diagram-code-error" class="diagram-code-error" role="alert" hidden></div><p class="diagram-code-hint">Usa <code>diagram</code>, <code>node</code>, <code>description</code> y <code>edge</code>. La guía completa está en <code>docs/diagramas-por-texto.md</code>.</p></div><div class="modal-actions"><button id="diagram-code-import" class="btn btn-secondary" type="button">Importar archivo</button><button id="diagram-code-copy" class="btn btn-secondary" type="button">Copiar</button><button id="diagram-code-export" class="btn btn-secondary" type="button">Exportar archivo</button><button class="btn btn-secondary" data-close-modal type="button">Cancelar</button><button id="diagram-code-apply" class="btn btn-primary" type="button">Generar diagrama</button></div></div></div>`;
  bindModalClose();
  const editor = $('#diagram-code-editor');
  const errorNode = $('#diagram-code-error');
  const sourceNode = $('#diagram-code-source');
  editor.focus();
  editor.addEventListener('input', () => setDiagramCodeError(errorNode));
  $('#diagram-code-copy').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Copiando…';
    try {
      await copyTextToClipboard(editor.value);
      showToast('Código copiado al portapapeles');
    } catch (error) {
      showToast(error.message || 'No se pudo copiar el código', true);
    } finally {
      button.disabled = false;
      button.textContent = 'Copiar';
    }
  });
  $('#diagram-code-export').addEventListener('click', (event) => exportDiagramText(editor.value, event.currentTarget));
  $('#diagram-code-import').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      if (typeof window.nexusData?.selectDiagramFile !== 'function') throw new Error('La importación de diagramas no está disponible');
      const selected = await window.nexusData.selectDiagramFile();
      if (!selected) return;
      editor.value = selected.content;
      if (sourceNode) sourceNode.textContent = fileNameFromPath(selected.path);
      setDiagramCodeError(errorNode);
      editor.focus();
    } catch (error) {
      showToast(error.message || 'No se pudo importar el diagrama', true);
    } finally {
      button.disabled = false;
    }
  });
  $('#diagram-code-apply').addEventListener('click', () => {
    try {
      applyDiagramText(editor.value);
      closeModal();
    } catch (error) {
      setDiagramCodeError(errorNode, error.message || 'El código del diagrama no es válido');
      editor.focus();
    }
  });
}

async function importDiagramFile() {
  try {
    if (typeof window.nexusData?.selectDiagramFile !== 'function') throw new Error('La importación de diagramas no está disponible');
    const selected = await window.nexusData.selectDiagramFile();
    if (selected) openDiagramCodeModal(selected.content, selected.path);
  } catch (error) {
    showToast(error.message || 'No se pudo importar el diagrama', true);
  }
}

export function bindDiagramMenu() {
  window.nexusData?.onDiagramMenuAction?.((action) => {
    if (!$('#view-diagrams')?.classList.contains('active')) return;
    if (!hasLoadedSources()) return;
    if (action === 'new') createNewDiagram();
    if (action === 'duplicate') duplicateActiveDiagram();
    if (action === 'code') openDiagramCodeModal();
    if (action === 'import') importDiagramFile();
    if (action === 'export') exportDiagramText(serializeDiagram(activeDiagram()));
    if (action === 'export-image') exportDiagramImage();
    if (action === 'delete') openDeleteDiagramConfirmation();
    if (action === 'undo') undoDiagramChange();
    if (action === 'redo') redoDiagramChange();
  });
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function historySnapshot() {
  return { diagrams: cloneValue(diagrams), activeDiagramId };
}

function historySnapshotKey(snapshot) {
  return JSON.stringify(snapshot);
}

function updateHistoryControls() {
  const undoButton = $('#diagram-undo');
  const redoButton = $('#diagram-redo');
  if (undoButton) undoButton.disabled = undoStack.length === 0;
  if (redoButton) redoButton.disabled = redoStack.length === 0;
}

function recordHistory(before) {
  const after = historySnapshot();
  if (!before || historySnapshotKey(before) === historySnapshotKey(after)) return;
  undoStack.push(cloneValue(before));
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack = [];
  updateHistoryControls();
}

function resetDiagramInteraction() {
  cancelEdgeLabelEditing();
  selection = { type: '', id: '' };
  connectMode = false;
  connectionStart = null;
  connectionAnchorNodeId = '';
  connectionDrag = null;
  dragState = null;
  resizeState = null;
  $('#diagram-canvas')?.classList.remove('is-panning');
  panState = null;
  contextMenuEdgeId = '';
  contextMenuNodeId = '';
  suppressedPortKeys.clear();
}

function restoreHistory(snapshot, message) {
  if (!snapshot) return;
  diagrams = cloneValue(snapshot.diagrams);
  activeDiagramId = diagrams.some((diagram) => diagram.id === snapshot.activeDiagramId)
    ? snapshot.activeDiagramId
    : diagrams[0]?.id || null;
  resetDiagramInteraction();
  persistDiagrams();
  renderDiagrams();
  if (message) showToast(message);
}

function undoDiagramChange() {
  if (!undoStack.length) return;
  const current = historySnapshot();
  const previous = undoStack.pop();
  redoStack.push(current);
  restoreHistory(previous);
}

function redoDiagramChange() {
  if (!redoStack.length) return;
  const current = historySnapshot();
  const next = redoStack.pop();
  undoStack.push(current);
  restoreHistory(next);
}

function beginTextHistory(element) {
  if (element && !pendingTextHistory.has(element)) pendingTextHistory.set(element, historySnapshot());
}

function finishTextHistory(element) {
  if (!element) return;
  const before = pendingTextHistory.get(element);
  if (!before) return;
  pendingTextHistory.delete(element);
  recordHistory(before);
}

function activeDiagram() {
  const sourceIds = loadedSourceIds();
  let diagram = diagrams.find((candidate) => (
    candidate.id === activeDiagramId && diagramBelongsToLoadedSource(candidate, sourceIds)
  ));
  if (!diagram) diagram = visibleDiagrams()[0] || null;
  if (!diagram) {
    const sourceId = sourceIds.values().next().value || null;
    diagram = sourceId
      ? createDiagram('Flujo principal', sourceId)
      : diagrams.find((candidate) => candidate.id === activeDiagramId) || createDiagram('Flujo principal');
    if (sourceId) diagrams = [...diagrams, diagram];
    activeDiagramId = diagram.id;
  }
  return diagram;
}

function nodeById(diagram, id) {
  return diagram.nodes.find((node) => node.id === id) || null;
}

function edgeById(diagram, id) {
  return diagram.edges.find((edge) => edge.id === id) || null;
}

function hideNodeContextMenu() {
  const menu = $('#diagram-node-context-menu');
  if (menu) {
    menu.hidden = true;
    menu.setAttribute('aria-hidden', 'true');
  }
  contextMenuNodeId = '';
}

function hideCanvasContextMenu() {
  const menu = $('#diagram-canvas-context-menu');
  if (menu) {
    menu.hidden = true;
    menu.setAttribute('aria-hidden', 'true');
  }
  contextMenuCanvasPoint = null;
}

function hideEdgeContextMenu() {
  const menu = $('#diagram-context-menu');
  if (menu) {
    menu.hidden = true;
    menu.setAttribute('aria-hidden', 'true');
  }
  contextMenuEdgeId = '';
  hideNodeContextMenu();
  hideCanvasContextMenu();
}

function syncEdgeContextMenu() {
  const menu = $('#diagram-context-menu');
  if (!menu || !contextMenuEdgeId) return;
  const edge = edgeById(activeDiagram(), contextMenuEdgeId);
  if (!edge) {
    hideEdgeContextMenu();
    return;
  }
  const direction = validEdgeDirection(edge.direction);
  menu.querySelectorAll('[data-edge-direction]').forEach((option) => {
    const isCurrent = option.dataset.edgeDirection === direction;
    option.classList.toggle('is-current', isCurrent);
    option.setAttribute('aria-checked', String(isCurrent));
  });
}

function showEdgeContextMenu(event, edgeId) {
  const edge = edgeById(activeDiagram(), edgeId);
  const menu = $('#diagram-context-menu');
  if (!edge || !menu) return;

  hideNodeContextMenu();
  hideCanvasContextMenu();
  setSelection('edge', edge.id);
  contextMenuEdgeId = edge.id;
  menu.hidden = false;
  menu.setAttribute('aria-hidden', 'false');
  syncEdgeContextMenu();

  const positionMenu = () => {
    if (menu.hidden) return;
    const margin = 8;
    const rect = menu.getBoundingClientRect();
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    menu.style.left = `${clamp(event.clientX, margin, maxLeft)}px`;
    menu.style.top = `${clamp(event.clientY, margin, maxTop)}px`;
  };
  positionMenu();
  requestAnimationFrame(positionMenu);
  menu.querySelector('.is-current')?.focus({ preventScroll: true });
}

function changeEdgeDirection(direction) {
  const edgeId = contextMenuEdgeId || (selection.type === 'edge' ? selection.id : '');
  const edge = edgeById(activeDiagram(), edgeId);
  if (!edge) {
    hideEdgeContextMenu();
    return;
  }
  const nextDirection = validEdgeDirection(direction);
  if (validEdgeDirection(edge.direction) === nextDirection) {
    hideEdgeContextMenu();
    return;
  }
  const before = historySnapshot();
  edge.direction = nextDirection;
  recordHistory(before);
  persistDiagrams();
  hideEdgeContextMenu();
  renderEdges(activeDiagram());
  updateSelectionUI();
  showToast(`Dirección: ${EDGE_DIRECTIONS[nextDirection]}`);
}

function handleEdgeContextMenuAction(event) {
  const option = event.target.closest?.('[data-edge-direction], [data-edge-action]');
  if (!option) return;
  event.preventDefault();
  event.stopPropagation();
  if (option.dataset.edgeAction === 'edit-label') {
    editEdgeLabel();
    return;
  }
  if (option.dataset.edgeAction === 'delete') {
    removeEdge(contextMenuEdgeId || (selection.type === 'edge' ? selection.id : ''));
    return;
  }
  changeEdgeDirection(option.dataset.edgeDirection);
}

function updateEdgeLabelEditorPosition() {
  if (!edgeLabelEditor) return;
  const diagram = activeDiagram();
  const edge = edgeById(diagram, edgeLabelEditor.edgeId);
  const geometry = edge ? edgeGeometry(edge, diagram) : null;
  if (!geometry) return;
  edgeLabelEditor.input.style.left = `${geometry.midpoint.x}px`;
  edgeLabelEditor.input.style.top = `${geometry.midpoint.y}px`;
}

function finishEdgeLabelEditing(commit = true) {
  const editor = edgeLabelEditor;
  if (!editor) return;
  edgeLabelEditor = null;

  const edge = edgeById(activeDiagram(), editor.edgeId);
  const nextLabel = editor.input.value.slice(0, 120);
  if (commit && edge && nextLabel !== edge.label) {
    edge.label = nextLabel;
    recordHistory(editor.historyBefore);
    persistDiagrams();
  }
  editor.input.remove();
  renderEdges(activeDiagram());
  updateSelectionUI();
}

function cancelEdgeLabelEditing() {
  const editor = edgeLabelEditor;
  if (!editor) return;
  edgeLabelEditor = null;
  editor.input.remove();
}

function startEdgeLabelEditing(edgeId) {
  const edge = edgeById(activeDiagram(), edgeId);
  const board = $('#diagram-board');
  if (!edge || !board) return;
  if (edgeLabelEditor?.edgeId === edge.id) {
    edgeLabelEditor.input.focus();
    edgeLabelEditor.input.select();
    return;
  }

  finishEdgeLabelEditing();
  hideEdgeContextMenu();
  setSelection('edge', edge.id);

  const geometry = edgeGeometry(edge, activeDiagram());
  if (!geometry) return;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'diagram-edge-label-editor';
  input.value = edge.label || '';
  input.maxLength = 120;
  input.autocomplete = 'off';
  input.spellcheck = true;
  input.setAttribute('aria-label', 'Texto de la conexión');
  input.addEventListener('pointerdown', (event) => event.stopPropagation());
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      finishEdgeLabelEditing();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      finishEdgeLabelEditing(false);
    }
  });
  input.addEventListener('blur', () => finishEdgeLabelEditing());
  edgeLabelEditor = { edgeId: edge.id, input, historyBefore: historySnapshot() };
  board.appendChild(input);
  updateEdgeLabelEditorPosition();
  input.focus();
  input.select();
}

function editEdgeLabel(edgeId = '') {
  const selectedEdgeId = edgeId || contextMenuEdgeId || (selection.type === 'edge' ? selection.id : '');
  startEdgeLabelEditing(selectedEdgeId);
}

function edgeIdFromEvent(event) {
  const hit = event.target.closest?.('[data-edge-id]');
  if (hit) return hit.dataset.edgeId;
  return event.target.closest?.('.diagram-edge-group')?.querySelector('[data-edge-id]')?.dataset.edgeId || '';
}

function syncNodeContextMenu() {
  const menu = $('#diagram-node-context-menu');
  if (!menu || !contextMenuNodeId) return;
  const node = nodeById(activeDiagram(), contextMenuNodeId);
  if (!node) {
    hideNodeContextMenu();
    return;
  }
  menu.querySelectorAll('[data-node-type]').forEach((option) => {
    const isCurrent = option.dataset.nodeType === validNodeType(node.type);
    option.classList.toggle('is-current', isCurrent);
    option.setAttribute('aria-checked', String(isCurrent));
  });
}

function showNodeContextMenu(event, nodeId) {
  const node = nodeById(activeDiagram(), nodeId);
  const menu = $('#diagram-node-context-menu');
  if (!node || !menu) return;

  hideEdgeContextMenu();
  setSelection('node', node.id);
  contextMenuNodeId = node.id;
  menu.hidden = false;
  menu.setAttribute('aria-hidden', 'false');
  syncNodeContextMenu();

  const positionMenu = () => {
    if (menu.hidden) return;
    const margin = 8;
    const rect = menu.getBoundingClientRect();
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    menu.style.left = `${clamp(event.clientX, margin, maxLeft)}px`;
    menu.style.top = `${clamp(event.clientY, margin, maxTop)}px`;
  };
  positionMenu();
  requestAnimationFrame(positionMenu);
  menu.querySelector('[data-node-type].is-current')?.focus({ preventScroll: true });
}

function changeNodeType(type) {
  const nodeId = contextMenuNodeId || (selection.type === 'node' ? selection.id : '');
  const node = nodeById(activeDiagram(), nodeId);
  if (!node) {
    hideEdgeContextMenu();
    return;
  }
  const nextType = validNodeType(type);
  if (validNodeType(node.type) === nextType) {
    hideEdgeContextMenu();
    return;
  }
  const before = historySnapshot();
  node.type = nextType;
  recordHistory(before);
  persistDiagrams();
  hideEdgeContextMenu();
  renderDiagrams();
  showToast(`Tipo de tarjeta: ${NODE_TYPES[nextType]}`);
}

function focusNodeDescription(nodeId) {
  const textarea = [...document.querySelectorAll('[data-node-description]')]
    .find((element) => element.dataset.nodeDescription === nodeId);
  if (!textarea) return;
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

function addNodeDescription() {
  const nodeId = contextMenuNodeId || (selection.type === 'node' ? selection.id : '');
  const node = nodeById(activeDiagram(), nodeId);
  if (!node) {
    hideEdgeContextMenu();
    return;
  }

  hideEdgeContextMenu();
  setSelection('node', node.id);
  if (hasNodeDescription(node)) {
    requestAnimationFrame(() => focusNodeDescription(node.id));
    return;
  }

  const before = historySnapshot();
  node.description = '';
  node.height = Math.max(nodeHeight(node), NODE_DESCRIPTION_MIN_HEIGHT);
  node.y = clamp(node.y, NODE_MARGIN, BOARD_HEIGHT - node.height - NODE_MARGIN);
  focusNodeDescriptionId = node.id;
  recordHistory(before);
  persistDiagrams();
  renderDiagrams();
  showToast('Descripción añadida a la tarjeta');
}

function focusNodeLabel(nodeId) {
  const input = [...document.querySelectorAll('[data-node-label]')]
    .find((element) => element.dataset.nodeLabel === nodeId);
  if (!input) return;
  input.focus();
  input.select();
}

function toggleConnectMode() {
  connectMode = !connectMode;
  connectionStart = null;
  connectionAnchorNodeId = '';
  updateSelectionUI();
}

function connectFromNode(nodeId) {
  const node = nodeById(activeDiagram(), nodeId);
  if (!node) return;
  connectionStart = null;
  connectionAnchorNodeId = node.id;
  connectMode = false;
  setSelection('node', node.id);
}

function handleNodeContextMenuAction(event) {
  const option = event.target.closest?.('[data-node-type], [data-node-action]');
  if (!option) return;
  event.preventDefault();
  event.stopPropagation();
  const nodeId = contextMenuNodeId || (selection.type === 'node' ? selection.id : '');
  if (option.dataset.nodeType) {
    changeNodeType(option.dataset.nodeType);
    return;
  }
  if (option.dataset.nodeAction === 'focus-label') {
    hideEdgeContextMenu();
    setSelection('node', nodeId);
    requestAnimationFrame(() => focusNodeLabel(nodeId));
    return;
  }
  if (option.dataset.nodeAction === 'connect') {
    hideEdgeContextMenu();
    connectFromNode(nodeId);
    return;
  }
  if (option.dataset.nodeAction === 'add-description') {
    addNodeDescription();
    return;
  }
  if (option.dataset.nodeAction === 'delete') {
    const node = nodeById(activeDiagram(), nodeId);
    hideEdgeContextMenu();
    if (node) openDeleteNodeConfirmation(node.id);
  }
}

function showCanvasContextMenu(event) {
  const menu = $('#diagram-canvas-context-menu');
  if (!menu) return;

  event.preventDefault();
  event.stopPropagation();
  hideEdgeContextMenu();
  setSelection();
  contextMenuCanvasPoint = boardPoint(event);
  menu.hidden = false;
  menu.setAttribute('aria-hidden', 'false');
  syncCanvasContextMenu();

  const positionMenu = () => {
    if (menu.hidden) return;
    const margin = 8;
    const rect = menu.getBoundingClientRect();
    const maxLeft = Math.max(margin, window.innerWidth - rect.width - margin);
    const maxTop = Math.max(margin, window.innerHeight - rect.height - margin);
    menu.style.left = `${clamp(event.clientX, margin, maxLeft)}px`;
    menu.style.top = `${clamp(event.clientY, margin, maxTop)}px`;
  };
  positionMenu();
  requestAnimationFrame(positionMenu);
  menu.querySelector('[data-canvas-action]')?.focus({ preventScroll: true });
}

function handleCanvasContextMenuAction(event) {
  const option = event.target.closest?.('[data-canvas-action]');
  if (!option) return;
  event.preventDefault();
  event.stopPropagation();
  const point = contextMenuCanvasPoint;
  hideCanvasContextMenu();
  if (option.dataset.canvasAction === 'add-node' && point) addNodeAt(point);
  if (option.dataset.canvasAction === 'toggle-connect') toggleConnectMode();
}

function findPortElement(nodeId, portName) {
  return [...document.querySelectorAll('[data-diagram-port]')]
    .find((port) => port.dataset.nodeId === nodeId && port.dataset.port === portName) || null;
}

function applyDiagramViewport() {
  const board = $('#diagram-board');
  const canvas = $('#diagram-canvas');
  if (!board || !canvas) return;
  board.style.transformOrigin = '0 0';
  board.style.transform = `matrix(${diagramViewport.zoom}, 0, 0, ${diagramViewport.zoom}, ${diagramViewport.offsetX}, ${diagramViewport.offsetY})`;
  const gridSize = DIAGRAM_GRID_SIZE * diagramViewport.zoom;
  canvas.style.backgroundSize = `${gridSize}px ${gridSize}px`;
  canvas.style.backgroundPosition = `${diagramViewport.offsetX}px ${diagramViewport.offsetY}px`;
}

function fitDiagramViewport() {
  const canvas = $('#diagram-canvas');
  if (!canvas || !canvas.clientWidth || !canvas.clientHeight) return;
  const zoom = clamp(Math.min(canvas.clientWidth / BOARD_WIDTH, canvas.clientHeight / BOARD_HEIGHT), DIAGRAM_ZOOM_MIN, 1);
  diagramViewport = {
    zoom,
    offsetX: (canvas.clientWidth - BOARD_WIDTH * zoom) / 2,
    offsetY: (canvas.clientHeight - BOARD_HEIGHT * zoom) / 2,
    initialized: true,
    userZoomed: false
  };
  applyDiagramViewport();
}

function ensureDiagramViewport() {
  if (!diagramViewport.initialized) fitDiagramViewport();
  else applyDiagramViewport();
}

function observeDiagramCanvas() {
  diagramResizeObserver?.disconnect();
  diagramResizeObserver = null;
  const canvas = $('#diagram-canvas');
  if (!canvas || typeof ResizeObserver === 'undefined') return;
  diagramResizeObserver = new ResizeObserver(() => {
    if (!diagramViewport.userZoomed) fitDiagramViewport();
    else applyDiagramViewport();
  });
  diagramResizeObserver.observe(canvas);
}

function boardPointFromCanvasCoordinates(x, y) {
  if (!diagramViewport.initialized) fitDiagramViewport();
  const zoom = diagramViewport.zoom || 1;
  return {
    x: clamp((x - diagramViewport.offsetX) / zoom, 0, BOARD_WIDTH),
    y: clamp((y - diagramViewport.offsetY) / zoom, 0, BOARD_HEIGHT)
  };
}

function zoomDiagramAtPoint(pointerX, pointerY, factor) {
  ensureDiagramViewport();
  const boardX = (pointerX - diagramViewport.offsetX) / diagramViewport.zoom;
  const boardY = (pointerY - diagramViewport.offsetY) / diagramViewport.zoom;
  const zoom = clamp(diagramViewport.zoom * factor, DIAGRAM_ZOOM_MIN, DIAGRAM_ZOOM_MAX);
  if (zoom === diagramViewport.zoom) return false;
  diagramViewport.zoom = zoom;
  diagramViewport.offsetX = pointerX - boardX * zoom;
  diagramViewport.offsetY = pointerY - boardY * zoom;
  diagramViewport.userZoomed = true;
  applyDiagramViewport();
  return true;
}

function zoomDiagramByFactor(factor) {
  const canvas = $('#diagram-canvas');
  if (!canvas) return;
  zoomDiagramAtPoint(canvas.clientWidth / 2, canvas.clientHeight / 2, factor);
}

function handleDiagramWheel(event) {
  const canvas = event.currentTarget || $('#diagram-canvas');
  if (!canvas) return;
  ensureDiagramViewport();
  const delta = event.deltaMode === 1
    ? event.deltaY * 16
    : event.deltaMode === 2
      ? event.deltaY * canvas.clientHeight
      : event.deltaY;
  if (!Number.isFinite(delta) || delta === 0) return;

  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const pointerX = event.clientX - rect.left;
  const pointerY = event.clientY - rect.top;
  const factor = Math.exp(clamp(-delta * DIAGRAM_ZOOM_SENSITIVITY, -0.35, 0.35));
  zoomDiagramAtPoint(pointerX, pointerY, factor);
}

function nodePoint(node, portName) {
  const port = PORTS[portName] || PORTS.right;
  const board = $('#diagram-board');
  const portElement = findPortElement(node.id, portName);
  if (board && portElement) {
    const boardRect = board.getBoundingClientRect();
    const portRect = portElement.getBoundingClientRect();
    if (boardRect.width && boardRect.height) {
      return {
        x: (portRect.left + portRect.width / 2 - boardRect.left) * BOARD_WIDTH / boardRect.width,
        y: (portRect.top + portRect.height / 2 - boardRect.top) * BOARD_HEIGHT / boardRect.height
      };
    }
  }
  return nodePointFromModel(node, portName);
}

function nodePointFromModel(node, portName) {
  const port = PORTS[portName] || PORTS.right;
  const width = nodeWidth(node);
  const height = nodeHeight(node);
  return {
    x: node.x + width * port.x,
    y: node.y + height * port.y
  };
}

function curveGeometry(start, end, sourcePortName, targetPortName = 'left') {
  const sourcePort = PORTS[sourcePortName] || PORTS.right;
  const targetPort = PORTS[targetPortName] || PORTS.left;
  const distance = clamp(Math.hypot(end.x - start.x, end.y - start.y) * 0.45, 60, 190);
  const firstControl = { x: start.x + sourcePort.dx * distance, y: start.y + sourcePort.dy * distance };
  const secondControl = { x: end.x + targetPort.dx * distance, y: end.y + targetPort.dy * distance };
  const path = `M ${start.x} ${start.y} C ${firstControl.x} ${firstControl.y}, ${secondControl.x} ${secondControl.y}, ${end.x} ${end.y}`;
  const midpoint = {
    x: 0.125 * start.x + 0.375 * firstControl.x + 0.375 * secondControl.x + 0.125 * end.x,
    y: 0.125 * start.y + 0.375 * firstControl.y + 0.375 * secondControl.y + 0.125 * end.y
  };
  return { path, midpoint, start, end };
}

function offsetFromPort(point, portName, distance = ARROW_INSET) {
  const port = PORTS[portName] || PORTS.right;
  return {
    x: point.x + port.dx * distance,
    y: point.y + port.dy * distance
  };
}

function directionalGeometry(start, end, sourcePortName, targetPortName, direction) {
  const adjustedStart = direction === 'backward'
    ? offsetFromPort(start, sourcePortName)
    : start;
  const adjustedEnd = direction === 'forward'
    ? offsetFromPort(end, targetPortName)
    : end;
  return curveGeometry(adjustedStart, adjustedEnd, sourcePortName, targetPortName);
}

function freePreviewGeometry(start, end, sourcePortName) {
  const sourcePort = PORTS[sourcePortName] || PORTS.right;
  const delta = { x: end.x - start.x, y: end.y - start.y };
  const length = Math.hypot(delta.x, delta.y);
  if (!length) return { path: `M ${start.x} ${start.y} L ${end.x} ${end.y}`, midpoint: start };

  const direction = { x: delta.x / length, y: delta.y / length };
  const alignment = direction.x * sourcePort.dx + direction.y * sourcePort.dy;
  const handle = Math.min(clamp(length * 0.35, 18, 100), length * 0.45);
  const firstDirection = alignment > 0.2
    ? { x: sourcePort.dx, y: sourcePort.dy }
    : direction;
  const firstControl = {
    x: start.x + firstDirection.x * handle,
    y: start.y + firstDirection.y * handle
  };
  const secondControl = {
    x: end.x - direction.x * handle,
    y: end.y - direction.y * handle
  };
  const path = `M ${start.x} ${start.y} C ${firstControl.x} ${firstControl.y}, ${secondControl.x} ${secondControl.y}, ${end.x} ${end.y}`;
  const midpoint = {
    x: 0.125 * start.x + 0.375 * firstControl.x + 0.375 * secondControl.x + 0.125 * end.x,
    y: 0.125 * start.y + 0.375 * firstControl.y + 0.375 * secondControl.y + 0.125 * end.y
  };
  return { path, midpoint };
}

function edgeGeometry(edge, diagram, useDom = true) {
  const sourceNode = nodeById(diagram, edge.source.nodeId);
  const targetNode = nodeById(diagram, edge.target.nodeId);
  if (!sourceNode || !targetNode) return null;
  const point = useDom ? nodePoint : nodePointFromModel;
  return directionalGeometry(
    point(sourceNode, edge.source.port),
    point(targetNode, edge.target.port),
    edge.source.port,
    edge.target.port,
    validEdgeDirection(edge.direction)
  );
}

function nodeMarkup(node) {
  const typeLabel = NODE_TYPES[node.type] || NODE_TYPES.step;
  const ports = Object.entries(PORTS).map(([port, value]) => `<button class="diagram-port diagram-port-${port}" type="button" data-diagram-port data-node-id="${escapeHtml(node.id)}" data-port="${port}" aria-label="Conectar por el punto de ${value.label}"></button>`).join('');
  const selectedClass = selection.type === 'node' && selection.id === node.id ? ' is-selected' : '';
  const connectionSourceClass = connectionAnchorNodeId === node.id ? ' is-connection-source' : '';
  const descriptionClass = hasNodeDescription(node) ? ' diagram-node-has-description' : '';
  const descriptionMarkup = hasNodeDescription(node)
    ? `<label class="diagram-node-description-wrap"><span class="diagram-node-description-title">Descripción</span><textarea class="diagram-node-description" data-node-description="${escapeHtml(node.id)}" rows="3" maxlength="${NODE_DESCRIPTION_MAX_LENGTH}" aria-label="Descripción de la tarjeta" placeholder="Añade detalles sobre este paso…">${escapeHtml(node.description)}</textarea></label>`
    : '';
  return `<article class="diagram-node diagram-node-${node.type}${descriptionClass}${selectedClass}${connectionSourceClass}" data-node-id="${escapeHtml(node.id)}" style="width: ${nodeWidth(node)}px; height: ${nodeHeight(node)}px; transform: translate(${node.x}px, ${node.y}px);"><div class="diagram-node-surface"><div class="diagram-node-topline"><span class="diagram-node-type">${escapeHtml(typeLabel)}</span><button class="diagram-node-delete" type="button" data-delete-node="${escapeHtml(node.id)}" aria-label="Eliminar nodo">×</button></div><input class="diagram-node-label" data-node-label="${escapeHtml(node.id)}" value="${escapeHtml(node.label)}" aria-label="Etiqueta del nodo" maxlength="160" />${descriptionMarkup}</div><button class="diagram-node-resize" type="button" data-resize-node="${escapeHtml(node.id)}" aria-label="Redimensionar tarjeta" title="Redimensionar tarjeta"></button>${ports}</article>`;
}

function renderNodes(diagram) {
  const layer = $('#diagram-node-layer');
  if (layer) layer.innerHTML = diagram.nodes.map(nodeMarkup).join('');
}

function renderEdges(diagram) {
  const layer = $('#diagram-edge-paths');
  if (!layer) return;
  const edgesMarkup = diagram.edges.map((edge, index) => {
    const geometry = edgeGeometry(edge, diagram);
    if (!geometry) return '';
    const selected = selection.type === 'edge' && selection.id === edge.id ? ' is-selected' : '';
    const direction = validEdgeDirection(edge.direction);
    const color = validEdgeColor(edge.color) || edgeColorForIndex(index);
    const marker = direction === 'forward'
      ? ' marker-end="url(#diagram-arrow)"'
      : direction === 'backward'
        ? ' marker-start="url(#diagram-arrow)"'
        : '';
    const endpointMarkup = direction === 'forward'
      ? `<circle class="diagram-edge-endpoint diagram-edge-source" data-edge-role="source" cx="${geometry.start.x}" cy="${geometry.start.y}" r="5"></circle>`
      : direction === 'backward'
        ? `<circle class="diagram-edge-endpoint diagram-edge-target" data-edge-role="target" cx="${geometry.end.x}" cy="${geometry.end.y}" r="5"></circle>`
        : `<circle class="diagram-edge-endpoint diagram-edge-source" data-edge-role="source" cx="${geometry.start.x}" cy="${geometry.start.y}" r="5"></circle><circle class="diagram-edge-endpoint diagram-edge-target" data-edge-role="target" cx="${geometry.end.x}" cy="${geometry.end.y}" r="5"></circle>`;
    const label = edge.label ? `<text class="diagram-edge-label" x="${geometry.midpoint.x}" y="${geometry.midpoint.y}" text-anchor="middle" dominant-baseline="middle">${escapeHtml(edge.label)}</text>` : '';
    return `<g class="diagram-edge-group${selected}" data-edge-direction="${direction}" data-edge-color="${color}"><path class="diagram-edge-backplate" d="${geometry.path}"></path><path class="diagram-edge${selected}" d="${geometry.path}" data-edge-direction="${direction}"${marker}></path>${endpointMarkup}<path class="diagram-edge-hit" d="${geometry.path}" data-edge-id="${escapeHtml(edge.id)}" tabindex="0" role="button" aria-label="Seleccionar conexión"></path>${label}</g>`;
  }).join('');
  const previewMarkup = connectionDrag?.moved && connectionDrag.current
    ? (() => {
      const sourceNode = nodeById(diagram, connectionDrag.source.nodeId);
      if (!sourceNode) return '';
      const target = connectionDrag.target?.nodeId === sourceNode.id ? null : connectionDrag.target;
      const targetNode = target ? nodeById(diagram, target.nodeId) : null;
      const sourcePoint = nodePoint(sourceNode, connectionDrag.source.port);
      const geometry = targetNode
        ? directionalGeometry(sourcePoint, nodePoint(targetNode, target.port), connectionDrag.source.port, target.port, 'forward')
        : freePreviewGeometry(sourcePoint, connectionDrag.current, connectionDrag.source.port);
      return `<path class="diagram-connection-preview" d="${geometry.path}" marker-end="url(#diagram-arrow-preview)"></path>`;
    })()
    : '';
  layer.innerHTML = `${edgesMarkup}${previewMarkup}`;
  updateEdgeLabelEditorPosition();
}

function updateStatus() {
  const diagram = activeDiagram();
  const status = $('#diagram-status');
  if (!status) return;
  if (connectionAnchorNodeId) {
    status.textContent = 'Tarjeta de origen seleccionada. Haz doble clic en otra tarjeta para conectarla.';
  } else if (connectMode && connectionStart) {
    const node = nodeById(diagram, connectionStart.nodeId);
    status.textContent = `Conectando desde “${node?.label || 'nodo'}”. Selecciona el punto de destino.`;
  } else if (connectMode) {
    status.textContent = 'Modo conexión activo. Selecciona un punto de origen.';
  } else if (selection.type === 'node') {
    status.textContent = 'Nodo seleccionado. Puedes editar su etiqueta, descripción o tipo.';
  } else if (selection.type === 'edge') {
    status.textContent = 'Conexión seleccionada. Haz doble clic en la línea para escribir su texto o cambia la Dirección.';
  } else {
    status.textContent = 'Doble clic en un espacio vacío para añadir un nodo.';
  }
  const count = $('#diagram-count');
  if (count) count.textContent = `${diagram.nodes.length} nodos · ${diagram.edges.length} conexiones`;
}

function updateSelectionUI() {
  const root = $('#view-diagrams');
  if (!root) return;
  root.querySelectorAll('.diagram-node').forEach((node) => {
    node.classList.toggle('is-selected', selection.type === 'node' && selection.id === node.dataset.nodeId);
    node.classList.toggle('is-connection-source', connectionAnchorNodeId === node.dataset.nodeId);
  });
  root.querySelectorAll('.diagram-edge').forEach((edge) => {
    const group = edge.closest('.diagram-edge-group');
    const edgeHit = group?.querySelector('[data-edge-id]');
    edge.classList.toggle('is-selected', selection.type === 'edge' && selection.id === edgeHit?.dataset.edgeId);
  });
  root.querySelectorAll('[data-diagram-port]').forEach((port) => port.classList.toggle('is-source', Boolean(connectionStart && connectionStart.nodeId === port.dataset.nodeId && connectionStart.port === port.dataset.port)));
  syncCanvasContextMenu();
  updateStatus();
  updateHistoryControls();
}

function renderDiagramCanvas() {
  const diagram = activeDiagram();
  renderNodes(diagram);
  renderEdges(diagram);
  const hint = $('#diagram-empty-hint');
  if (hint) hint.hidden = diagram.nodes.length > 0;
}

export function renderDiagrams() {
  const root = $('#view-diagrams');
  if (!root) return;
  if (renderSourcesRequired(root)) return;
  hideEdgeContextMenu();
  const diagram = activeDiagram();
  const selectableDiagrams = visibleDiagrams();
  root.innerHTML = `<div class="diagram-shell"><header class="diagram-toolbar"><div class="diagram-title-wrap">${sectionIconMarkup('diagrams')}<div class="diagram-title-copy"><span class="diagram-eyebrow">DIAGRAMAS</span><input id="diagram-title" class="diagram-title" value="${escapeHtml(diagram.title)}" maxlength="120" aria-label="Nombre del diagrama" /></div></div><div class="diagram-toolbar-actions"><label class="diagram-select-wrap"><span>Documento</span><select id="diagram-select" class="diagram-select">${selectableDiagrams.map((item) => `<option value="${escapeHtml(item.id)}"${item.id === diagram.id ? ' selected' : ''}>${escapeHtml(item.title)}</option>`).join('')}</select></label></div></header><div class="diagram-main"><div class="diagram-canvas" id="diagram-canvas"><div class="diagram-board" id="diagram-board" style="width: ${BOARD_WIDTH}px; height: ${BOARD_HEIGHT}px;"><svg id="diagram-edge-layer" class="diagram-edge-layer" viewBox="0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}" aria-label="Conexiones del diagrama"><defs><marker id="diagram-arrow" markerWidth="14" markerHeight="14" refX="12" refY="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M 0 0 L 12 7 L 0 14 z" fill="currentColor"></path></marker><marker id="diagram-arrow-preview" markerWidth="14" markerHeight="14" refX="12" refY="7" orient="auto" markerUnits="userSpaceOnUse"><path d="M 0 0 L 12 7 L 0 14 z" fill="currentColor"></path></marker></defs><g id="diagram-edge-paths"></g></svg><div id="diagram-node-layer" class="diagram-node-layer"></div><div id="diagram-empty-hint" class="diagram-empty-hint"><strong>Empieza tu flujo</strong><span>Añade un nodo o haz doble clic en el lienzo</span></div></div></div></div></div>`;
  ensureDiagramViewport();
  observeDiagramCanvas();
  const arrowMarker = root.querySelector('#diagram-arrow');
  if (arrowMarker) {
    arrowMarker.setAttribute('orient', 'auto-start-reverse');
    arrowMarker.setAttribute('markerUnits', 'userSpaceOnUse');
    arrowMarker.setAttribute('markerWidth', '14');
    arrowMarker.setAttribute('markerHeight', '14');
    arrowMarker.setAttribute('refX', '12');
    arrowMarker.setAttribute('refY', '7');
    arrowMarker.querySelector('path')?.setAttribute('d', 'M 0 0 L 12 7 L 0 14 z');
  }
  const previewArrowMarker = root.querySelector('#diagram-arrow-preview');
  if (previewArrowMarker) {
    previewArrowMarker.setAttribute('markerWidth', '14');
    previewArrowMarker.setAttribute('markerHeight', '14');
    previewArrowMarker.setAttribute('refX', '12');
    previewArrowMarker.setAttribute('refY', '7');
    previewArrowMarker.querySelector('path')?.setAttribute('d', 'M 0 0 L 12 7 L 0 14 z');
  }
  root.insertAdjacentHTML('beforeend', '<div id="diagram-context-menu" class="diagram-context-menu" role="menu" aria-label="Acciones de la conexión" aria-hidden="true" hidden><button type="button" role="menuitem" data-edge-action="edit-label">Editar texto</button><div class="diagram-context-menu-heading">Dirección</div><button type="button" role="menuitemradio" data-edge-direction="none" aria-checked="false">Línea simple</button><button type="button" role="menuitemradio" data-edge-direction="forward" aria-checked="false">→ Hacia el destino</button><button type="button" role="menuitemradio" data-edge-direction="backward" aria-checked="false">← Hacia el origen</button></div><div id="diagram-node-context-menu" class="diagram-context-menu" role="menu" aria-label="Modificar tarjeta" aria-hidden="true" hidden><div class="diagram-context-menu-heading">Tarjeta</div><button type="button" role="menuitem" data-node-action="focus-label">Editar etiqueta</button><button type="button" role="menuitem" data-node-action="add-description">Añadir descripción</button><div class="diagram-context-menu-heading">Tipo</div><button type="button" role="menuitemradio" data-node-type="start" aria-checked="false">Inicio</button><button type="button" role="menuitemradio" data-node-type="step" aria-checked="false">Paso</button><button type="button" role="menuitemradio" data-node-type="decision" aria-checked="false">Decisión</button><button type="button" role="menuitemradio" data-node-type="end" aria-checked="false">Fin</button><button type="button" role="menuitem" data-node-action="delete">Eliminar tarjeta</button></div>');
  root.querySelector('#diagram-context-menu')?.insertAdjacentHTML('beforeend', '<button type="button" role="menuitem" data-edge-action="delete">Eliminar conexión</button>');
  root.querySelector('#diagram-node-context-menu [data-node-action="delete"]')?.insertAdjacentHTML('beforebegin', '<button type="button" role="menuitem" data-node-action="connect">Conectar desde aquí</button>');
  root.insertAdjacentHTML('beforeend', '<div id="diagram-canvas-context-menu" class="diagram-context-menu" role="menu" aria-label="Acciones del canvas" aria-hidden="true" hidden><div class="diagram-context-menu-heading">Canvas</div><button type="button" role="menuitem" data-canvas-action="add-node">＋ Agregar nodo</button><button type="button" role="menuitem" data-canvas-action="toggle-connect">Activar modo conexión</button></div>');
  bindDiagramEvents(root);
  renderDiagramCanvas();
  updateSelectionUI();
  if (focusNodeId) {
    const nodeId = focusNodeId;
    focusNodeId = null;
    requestAnimationFrame(() => document.querySelector(`[data-node-label="${nodeId}"]`)?.focus());
  }
  if (focusNodeDescriptionId) {
    const nodeId = focusNodeDescriptionId;
    focusNodeDescriptionId = null;
    requestAnimationFrame(() => focusNodeDescription(nodeId));
  }
}

function setSelection(type = '', id = '') {
  hideEdgeContextMenu();
  selection = { type, id };
  updateSelectionUI();
}

function boardPoint(event) {
  const canvas = $('#diagram-canvas');
  if (!canvas) return { x: BOARD_WIDTH / 2, y: BOARD_HEIGHT / 2 };
  ensureDiagramViewport();
  const rect = canvas.getBoundingClientRect();
  return boardPointFromCanvasCoordinates(event.clientX - rect.left, event.clientY - rect.top);
}

function nodePositionIsFree(diagram, x, y) {
  const width = NODE_WIDTH;
  const height = NODE_HEIGHT;
  return diagram.nodes.every((node) => (
    x + width + NODE_MARGIN <= node.x
    || node.x + nodeWidth(node) + NODE_MARGIN <= x
    || y + height + NODE_MARGIN <= node.y
    || node.y + nodeHeight(node) + NODE_MARGIN <= y
  ));
}

function findAvailableNodePosition(diagram, preferred) {
  const candidates = [
    preferred,
    { x: preferred.x + NODE_WIDTH + 44, y: preferred.y },
    { x: preferred.x - NODE_WIDTH - 44, y: preferred.y },
    { x: preferred.x, y: preferred.y + NODE_HEIGHT + 44 },
    { x: preferred.x, y: preferred.y - NODE_HEIGHT - 44 },
    { x: preferred.x + NODE_WIDTH + 44, y: preferred.y + NODE_HEIGHT + 44 },
    { x: preferred.x - NODE_WIDTH - 44, y: preferred.y + NODE_HEIGHT + 44 }
  ];
  for (const candidate of candidates) {
    const x = clamp(candidate.x, NODE_MARGIN, BOARD_WIDTH - NODE_WIDTH - NODE_MARGIN);
    const y = clamp(candidate.y, NODE_MARGIN, BOARD_HEIGHT - NODE_HEIGHT - NODE_MARGIN);
    if (nodePositionIsFree(diagram, x, y)) return { x, y };
  }
  for (let row = 0; row < 6; row += 1) {
    for (let column = 0; column < 6; column += 1) {
      const x = NODE_MARGIN + column * (NODE_WIDTH + 44);
      const y = NODE_MARGIN + row * (NODE_HEIGHT + 44);
      if (nodePositionIsFree(diagram, x, y)) return { x, y };
    }
  }
  return {
    x: clamp(preferred.x, NODE_MARGIN, BOARD_WIDTH - NODE_WIDTH - NODE_MARGIN),
    y: clamp(preferred.y, NODE_MARGIN, BOARD_HEIGHT - NODE_HEIGHT - NODE_MARGIN)
  };
}

function addNodeAt(point, label = 'Nuevo paso') {
  const diagram = activeDiagram();
  const before = historySnapshot();
  const position = findAvailableNodePosition(diagram, {
    x: point.x - NODE_WIDTH / 2,
    y: point.y - NODE_HEIGHT / 2
  });
  const node = {
    id: makeId('node'),
    label,
    type: 'step',
    x: position.x,
    y: position.y,
    width: NODE_WIDTH,
    height: NODE_HEIGHT
  };
  diagram.nodes.push(node);
  selection = { type: 'node', id: node.id };
  focusNodeId = node.id;
  recordHistory(before);
  persistDiagrams();
  renderDiagrams();
}

function beginNodeResize(event, handle) {
  const node = nodeById(activeDiagram(), handle.dataset.resizeNode);
  if (!node) return;
  event.preventDefault();
  event.stopPropagation();
  setSelection('node', node.id);
  resizeState = {
    id: node.id,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startWidth: nodeWidth(node),
    startHeight: nodeHeight(node),
    moved: false,
    historyBefore: historySnapshot()
  };
  handle.setPointerCapture?.(event.pointerId);
}

function duplicateActiveDiagram() {
  const current = activeDiagram();
  const before = historySnapshot();
  const copy = normaliseDiagram({
    ...cloneValue(current),
    id: makeId('diagram'),
    title: duplicateDiagramTitle(current.title)
  }, diagrams.length);
  diagrams = [...diagrams, copy];
  activeDiagramId = copy.id;
  resetDiagramInteraction();
  recordHistory(before);
  persistDiagrams();
  renderDiagrams();
}

function createNewDiagram() {
  const before = historySnapshot();
  const current = activeDiagram();
  const next = createDiagram(`Diagrama ${visibleDiagrams().length + 1}`, current.sourceId || preferredSourceId());
  diagrams = [...diagrams, next];
  activeDiagramId = next.id;
  resetDiagramInteraction();
  recordHistory(before);
  persistDiagrams();
  renderDiagrams();
  showToast('Nuevo diagrama creado');
}

function removeEdge(edgeId) {
  const diagram = activeDiagram();
  const edge = edgeById(diagram, edgeId);
  if (!edge) {
    hideEdgeContextMenu();
    return;
  }
  const before = historySnapshot();
  diagram.edges = diagram.edges.filter((candidate) => candidate.id !== edge.id);
  if (selection.type === 'edge' && selection.id === edge.id) selection = { type: '', id: '' };
  recordHistory(before);
  persistDiagrams();
  hideEdgeContextMenu();
  renderDiagrams();
  showToast('Conexión eliminada');
}

function removeNode(nodeId) {
  const diagram = activeDiagram();
  const before = historySnapshot();
  diagram.nodes = diagram.nodes.filter((node) => node.id !== nodeId);
  diagram.edges = diagram.edges.filter((edge) => edge.source.nodeId !== nodeId && edge.target.nodeId !== nodeId);
  if (selection.id === nodeId) selection = { type: '', id: '' };
  if (connectionStart?.nodeId === nodeId) connectionStart = null;
  if (connectionAnchorNodeId === nodeId) connectionAnchorNodeId = '';
  recordHistory(before);
  persistDiagrams();
  renderDiagrams();
}

function removeSelection() {
  if (selection.type === 'node' && selection.id) {
    openDeleteNodeConfirmation(selection.id);
    return;
  }
  if (selection.type === 'edge' && selection.id) {
    removeEdge(selection.id);
  }
}

function deleteActiveDiagram() {
  const current = activeDiagram();
  const before = historySnapshot();
  diagrams = diagrams.filter((diagram) => diagram.id !== current.id);
  const nextDiagram = visibleDiagrams()[0] || createDiagram('Flujo principal', preferredSourceId());
  if (!diagrams.some((diagram) => diagram.id === nextDiagram.id)) diagrams = [...diagrams, nextDiagram];
  activeDiagramId = nextDiagram.id;
  resetDiagramInteraction();
  recordHistory(before);
  persistDiagrams();
  renderDiagrams();
  showToast(`Diagrama “${current.title}” eliminado`);
}

function openDeleteDiagramConfirmation() {
  const diagram = activeDiagram();
  $('#modal-root').innerHTML = `<div id="diagram-delete-confirmation" class="modal-backdrop"><div class="modal diagram-delete-confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="diagram-delete-confirmation-title" aria-describedby="diagram-delete-confirmation-description"><div class="modal-head"><div><h2 id="diagram-delete-confirmation-title">Eliminar diagrama</h2></div><button class="modal-close" data-close-modal aria-label="Cerrar">×</button></div><div class="modal-body"><p id="diagram-delete-confirmation-description">¿Quieres eliminar por completo el diagrama “${escapeHtml(diagram.title)}”? Se borrarán todos sus nodos y conexiones.</p></div><div class="modal-actions"><button id="diagram-delete-cancel" class="btn btn-secondary" data-close-modal type="button">No</button><button id="diagram-delete-confirm" class="btn btn-danger" type="button">Sí</button></div></div></div>`;
  bindModalClose();
  const modal = $('#diagram-delete-confirmation');
  const cancelButton = $('#diagram-delete-cancel');
  const confirmButton = $('#diagram-delete-confirm');
  modal?.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeModal();
  });
  confirmButton?.addEventListener('click', () => {
    closeModal();
    deleteActiveDiagram();
  });
  cancelButton?.focus();
}

function openDeleteNodeConfirmation(nodeId) {
  hideEdgeContextMenu();
  const node = nodeById(activeDiagram(), nodeId);
  if (!node) return;
  const nodeLabel = node.label?.trim() || 'esta tarjeta';
  $('#modal-root').innerHTML = `<div id="diagram-node-delete-confirmation" class="modal-backdrop"><div class="modal diagram-delete-confirmation-modal" role="dialog" aria-modal="true" aria-labelledby="diagram-node-delete-confirmation-title" aria-describedby="diagram-node-delete-confirmation-description"><div class="modal-head"><div><h2 id="diagram-node-delete-confirmation-title">Eliminar nodo</h2></div><button class="modal-close" data-close-modal aria-label="Cerrar">×</button></div><div class="modal-body"><p id="diagram-node-delete-confirmation-description">¿Quieres eliminar la tarjeta “${escapeHtml(nodeLabel)}”? También se eliminarán sus conexiones.</p></div><div class="modal-actions"><button id="diagram-node-delete-cancel" class="btn btn-secondary" data-close-modal type="button">No</button><button id="diagram-node-delete-confirm" class="btn btn-danger" type="button">Sí, eliminar</button></div></div></div>`;
  bindModalClose();
  const modal = $('#diagram-node-delete-confirmation');
  const cancelButton = $('#diagram-node-delete-cancel');
  const confirmButton = $('#diagram-node-delete-confirm');
  modal?.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeModal();
  });
  confirmButton?.addEventListener('click', () => {
    closeModal();
    if (!nodeById(activeDiagram(), node.id)) return;
    removeNode(node.id);
    showToast('Tarjeta eliminada');
  });
  cancelButton?.focus();
}

function commitConnection(source, target) {
  if (!source || !target) return false;
  if (source.nodeId === target.nodeId) {
    showToast('Selecciona un punto de otro nodo para crear la conexión', true);
    return false;
  }
  const diagram = activeDiagram();
  const before = historySnapshot();
  const edge = { id: makeId('edge'), source, target, label: '', direction: 'forward', color: nextEdgeColor(diagram) };
  diagram.edges.push(edge);
  connectionStart = null;
  connectionAnchorNodeId = '';
  selection = { type: 'edge', id: edge.id };
  recordHistory(before);
  persistDiagrams();
  renderDiagrams();
  showToast('Conexión creada');
  return true;
}

function connectionPortsBetween(sourceNode, targetNode) {
  const deltaX = (targetNode.x + nodeWidth(targetNode) / 2) - (sourceNode.x + nodeWidth(sourceNode) / 2);
  const deltaY = (targetNode.y + nodeHeight(targetNode) / 2) - (sourceNode.y + nodeHeight(sourceNode) / 2);
  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    return deltaX >= 0
      ? { sourcePort: 'right', targetPort: 'left' }
      : { sourcePort: 'left', targetPort: 'right' };
  }
  return deltaY >= 0
    ? { sourcePort: 'bottom', targetPort: 'top' }
    : { sourcePort: 'top', targetPort: 'bottom' };
}

function handleNodeDoubleClick(event) {
  const element = event.target.closest?.('.diagram-node');
  if (!element || event.target.closest('button, input, textarea')) return;
  const node = nodeById(activeDiagram(), element.dataset.nodeId);
  if (!node) return;

  event.preventDefault();
  event.stopPropagation();
  if (!connectionAnchorNodeId) {
    connectionAnchorNodeId = node.id;
    connectionStart = null;
    connectMode = false;
    setSelection('node', node.id);
    return;
  }
  if (connectionAnchorNodeId === node.id) {
    connectionAnchorNodeId = '';
    updateSelectionUI();
    return;
  }

  const sourceNode = nodeById(activeDiagram(), connectionAnchorNodeId);
  if (!sourceNode) {
    connectionAnchorNodeId = node.id;
    setSelection('node', node.id);
    return;
  }
  const { sourcePort, targetPort } = connectionPortsBetween(sourceNode, node);
  connectionAnchorNodeId = '';
  commitConnection(
    { nodeId: sourceNode.id, port: sourcePort },
    { nodeId: node.id, port: targetPort }
  );
}

function handlePortSelection(port) {
  if (!connectMode || !port) return;
  const next = { nodeId: port.dataset.nodeId, port: port.dataset.port };
  if (!connectionStart) {
    connectionStart = next;
    setSelection('node', next.nodeId);
    return;
  }
  commitConnection(connectionStart, next);
}

function beginConnectionDrag(event, port) {
  const hadConnectionAnchor = Boolean(connectionAnchorNodeId);
  connectionAnchorNodeId = '';
  if (hadConnectionAnchor) updateSelectionUI();
  connectionDrag = {
    source: { nodeId: port.dataset.nodeId, port: port.dataset.port },
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    current: null,
    target: null,
    moved: false
  };
  port.setPointerCapture?.(event.pointerId);
}

function targetConnectionFromPoint(event) {
  const elements = typeof document.elementsFromPoint === 'function'
    ? document.elementsFromPoint(event.clientX, event.clientY)
    : [document.elementFromPoint(event.clientX, event.clientY)];
  const exactPort = elements.find((element) => element?.closest?.('[data-diagram-port]'))?.closest?.('[data-diagram-port]');
  if (exactPort) return { nodeId: exactPort.dataset.nodeId, port: exactPort.dataset.port };

  // El cursor puede quedar un par de píxeles fuera del botón porque el punto
  // sobresale del borde de la tarjeta. Permitimos ese margen, pero nunca toda
  // la superficie de la tarjeta.
  const nearestPort = [...document.querySelectorAll('[data-diagram-port]')]
    .map((port) => {
      const rect = port.getBoundingClientRect();
      return {
        port,
        distance: Math.hypot(event.clientX - (rect.left + rect.width / 2), event.clientY - (rect.top + rect.height / 2)),
        radius: Math.max(rect.width, rect.height) * 0.9
      };
    })
    .sort((left, right) => left.distance - right.distance)[0];
  if (nearestPort && nearestPort.distance <= nearestPort.radius) {
    return { nodeId: nearestPort.port.dataset.nodeId, port: nearestPort.port.dataset.port };
  }
  return null;
}

function finishConnectionDrag(event) {
  const drag = connectionDrag;
  if (!drag || drag.pointerId !== event.pointerId) return false;
  connectionDrag = null;
  if (!drag.moved) return false;
  connectionStart = null;
  const target = targetConnectionFromPoint(event);
  suppressedPortKeys = new Set([`${drag.source.nodeId}:${drag.source.port}`]);
  if (target) suppressedPortKeys.add(`${target.nodeId}:${target.port}`);
  if (!target) {
    renderEdges(activeDiagram());
    updateSelectionUI();
    showToast('Suelta exactamente sobre un punto de unión', true);
    return true;
  }
  const created = commitConnection(drag.source, target);
  if (!created) {
    renderEdges(activeDiagram());
    updateSelectionUI();
  }
  return true;
}

function handleNodePointerDown(event) {
  if (event.target.closest('[data-delete-node]')) return;
  const resizeHandle = event.target.closest('[data-resize-node]');
  if (resizeHandle && event.button === 0) {
    beginNodeResize(event, resizeHandle);
    return;
  }
  const port = event.target.closest('[data-diagram-port]');
  if (port && event.button === 0) {
    beginConnectionDrag(event, port);
    return;
  }
  const element = event.target.closest('.diagram-node');
  if (!element || event.button !== 0) return;
  setSelection('node', element.dataset.nodeId);
  if (event.target.closest('input, textarea, button')) return;
  const rect = element.getBoundingClientRect();
  const board = $('#diagram-board');
  const boardRect = board?.getBoundingClientRect();
  const scaleX = boardRect?.width ? boardRect.width / BOARD_WIDTH : 1;
  const scaleY = boardRect?.height ? boardRect.height / BOARD_HEIGHT : 1;
  dragState = {
    id: element.dataset.nodeId,
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    offsetX: (event.clientX - rect.left) / scaleX,
    offsetY: (event.clientY - rect.top) / scaleY,
    moved: false,
    historyBefore: historySnapshot()
  };
  element.setPointerCapture?.(event.pointerId);
}

function handleNodeContextMenu(event) {
  const element = event.target.closest?.('.diagram-node');
  if (!element) return;
  event.preventDefault();
  event.stopPropagation();
  showNodeContextMenu(event, element.dataset.nodeId);
}

function handleNodeClick(event) {
  const port = event.target.closest('[data-diagram-port]');
  if (port) {
    const portKey = `${port.dataset.nodeId}:${port.dataset.port}`;
    if (suppressedPortKeys.has(portKey)) {
      suppressedPortKeys.delete(portKey);
      return;
    }
    suppressedPortKeys.clear();
    handlePortSelection(port);
    return;
  }
  const deleteButton = event.target.closest('[data-delete-node]');
  if (deleteButton) {
    event.stopPropagation();
    openDeleteNodeConfirmation(deleteButton.dataset.deleteNode);
    return;
  }
  const element = event.target.closest('.diagram-node');
  if (!element) return;
  if (lastDraggedNode.id === element.dataset.nodeId && Date.now() - lastDraggedNode.timestamp < 250) {
    lastDraggedNode = { id: '', timestamp: 0 };
    return;
  }
  setSelection('node', element.dataset.nodeId);
}

function handleNodeInput(event) {
  const input = event.target.closest('[data-node-label], [data-node-description]');
  if (!input) return;
  const nodeId = input.dataset.nodeLabel || input.dataset.nodeDescription;
  const node = nodeById(activeDiagram(), nodeId);
  if (!node) return;
  beginTextHistory(input);
  if (input.dataset.nodeLabel) node.label = input.value.slice(0, 160);
  if (input.dataset.nodeDescription) node.description = input.value.slice(0, NODE_DESCRIPTION_MAX_LENGTH);
  persistDiagrams();
  if (selection.type === 'node' && selection.id === node.id) {
    updateStatus();
  }
}

function handleEdgeClick(event) {
  const edgeId = edgeIdFromEvent(event);
  if (!edgeId) return;
  event.stopPropagation();
  setSelection('edge', edgeId);
}

function handleEdgeDoubleClick(event) {
  const edgeId = edgeIdFromEvent(event);
  if (!edgeId) return;
  event.preventDefault();
  event.stopPropagation();
  editEdgeLabel(edgeId);
}

function handleEdgeContextMenu(event) {
  const hit = event.target.closest?.('[data-edge-id]');
  if (!hit) return;
  event.preventDefault();
  event.stopPropagation();
  showEdgeContextMenu(event, hit.dataset.edgeId);
}

function handleBoardPointerDown(event) {
  if (event.target === event.currentTarget || event.target.id === 'diagram-edge-layer') {
    connectionAnchorNodeId = '';
    setSelection();
  }
}

function beginDiagramPan(event) {
  const canvas = event.currentTarget;
  if (event.button !== 0 || !canvas || event.target.closest?.('.diagram-node, .diagram-edge-group, [data-edge-id], [data-diagram-port]')) return;
  event.preventDefault();
  hideEdgeContextMenu();
  connectionAnchorNodeId = '';
  setSelection();
  ensureDiagramViewport();
  panState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    startOffsetX: diagramViewport.offsetX,
    startOffsetY: diagramViewport.offsetY,
    moved: false
  };
  canvas.classList.add('is-panning');
  canvas.setPointerCapture?.(event.pointerId);
}

function escapeSvg(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&apos;',
    '"': '&quot;'
  }[character]));
}

function diagramCssColor(name, fallback) {
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof window.getComputedStyle !== 'function') {
    return fallback;
  }
  return window.getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function diagramImageColors() {
  return {
    canvas: diagramCssColor('--canvas', '#171717'),
    gridLine: diagramCssColor('--grid-line', 'rgba(255, 255, 255, .045)'),
    surface: diagramCssColor('--surface', '#252526'),
    surfaceDeep: diagramCssColor('--surface-deep', '#171717'),
    strong: diagramCssColor('--strong', '#f2f2f2'),
    muted: diagramCssColor('--muted', '#858585'),
    blue: diagramCssColor('--blue', '#3794ff'),
    green: diagramCssColor('--green', '#89d185'),
    amber: diagramCssColor('--amber', '#dcdcaa'),
    red: diagramCssColor('--red', '#f48771'),
    purple: diagramCssColor('--purple', '#c586c0'),
    cyan: diagramCssColor('--cyan', '#4ec9b0'),
    accentBorder: diagramCssColor('--accent-border-strong', '#405b75'),
    accentText: diagramCssColor('--accent-text', '#9bceff'),
    accentTextSoft: diagramCssColor('--accent-text-soft', '#a8bbce'),
    successSurface: diagramCssColor('--success-surface', '#263526'),
    successBorder: diagramCssColor('--success-border', 'rgba(137, 209, 133, .4)'),
    warningSurface: diagramCssColor('--warning-surface', 'rgba(220, 220, 170, .08)'),
    warningBorder: diagramCssColor('--warning-border', 'rgba(220, 220, 170, .35)'),
    errorSurface: diagramCssColor('--error-surface', '#3a2926'),
    dangerBorder: diagramCssColor('--danger-border', '#5b3630'),
    edgeColors: {
      blue: diagramCssColor('--diagram-edge-blue', '#3794ff'),
      amber: diagramCssColor('--diagram-edge-amber', '#dcdcaa'),
      purple: diagramCssColor('--diagram-edge-purple', '#c586c0'),
      cyan: diagramCssColor('--diagram-edge-cyan', '#4ec9b0'),
      green: diagramCssColor('--diagram-edge-green', '#89d185'),
      red: diagramCssColor('--diagram-edge-red', '#f48771')
    }
  };
}

function wrapSvgText(value, maxCharacters = 24, maxLines = 3) {
  const words = String(value ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [''];
  const lines = [];
  let current = '';
  words.forEach((word) => {
    const chunks = word.length > maxCharacters
      ? word.match(new RegExp(`.{1,${maxCharacters}}`, 'g')) || [word]
      : [word];
    chunks.forEach((chunk) => {
      const candidate = current ? `${current} ${chunk}` : chunk;
      if (candidate.length <= maxCharacters) {
        current = candidate;
      } else {
        if (current) lines.push(current);
        current = chunk;
      }
    });
  });
  if (current) lines.push(current);
  if (lines.length <= maxLines) return lines;
  const visibleLines = lines.slice(0, maxLines);
  const lastLine = visibleLines[maxLines - 1].slice(0, Math.max(1, maxCharacters - 1)).replace(/\s+$/, '');
  visibleLines[maxLines - 1] = `${lastLine}…`;
  return visibleLines;
}

function svgTextLines(lines, { x, y, anchor = 'start', fill, fontSize = 13, weight = 400, lineHeight = 16 } = {}) {
  const xValue = Number(x);
  const yValue = Number(y);
  return `<text x="${xValue}" y="${Number(yValue)}" text-anchor="${anchor}" fill="${escapeSvg(fill)}" font-family="ui-monospace, SFMono-Regular, Consolas, monospace" font-size="${fontSize}" font-weight="${weight}">${lines.map((line, index) => `<tspan x="${xValue}" dy="${index ? lineHeight : 0}">${escapeSvg(line)}</tspan>`).join('')}</text>`;
}

function diagramNodeSvg(node, colors) {
  const type = validNodeType(node.type);
  const x = Number(node.x) || 0;
  const y = Number(node.y) || 0;
  const width = nodeWidth(node);
  const height = nodeHeight(node);
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const hasDescription = hasNodeDescription(node);
  const fontScale = currentDiagramFontScale();
  const typeFontSize = 10 * fontScale;
  const typeLineHeight = 12 * fontScale;
  const labelFontSize = 13 * fontScale;
  const labelLineHeight = 16 * fontScale;
  const descriptionTitleFontSize = 10 * fontScale;
  const descriptionTitleLineHeight = 12 * fontScale;
  const descriptionFontSize = 11 * fontScale;
  const descriptionLineHeight = 14 * fontScale;
  const rounded = !hasDescription && (type === 'start' || type === 'end');
  const shape = type === 'decision' && !hasDescription
    ? `<polygon points="${centerX},${y} ${x + width},${centerY} ${centerX},${y + height} ${x},${centerY}" fill="${escapeSvg(colors.warningSurface)}" stroke="${escapeSvg(colors.warningBorder)}" stroke-width="1.5" filter="url(#diagram-image-shadow)"></polygon>`
    : `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${rounded ? Math.min(width, height) / 2 : 6}" fill="${escapeSvg(type === 'start' ? colors.successSurface : type === 'end' ? colors.errorSurface : type === 'decision' ? colors.warningSurface : colors.surface)}" stroke="${escapeSvg(type === 'start' ? colors.successBorder : type === 'end' ? colors.dangerBorder : type === 'decision' ? colors.warningBorder : colors.accentBorder)}" stroke-width="${type === 'end' ? 3 : 1.5}" filter="url(#diagram-image-shadow)"></rect>`;
  const accent = type === 'step'
    ? `<line x1="${x + 1}" y1="${y + 7}" x2="${x + 1}" y2="${y + height - 7}" stroke="${escapeSvg(colors.accentTextSoft)}" stroke-width="3" stroke-linecap="round"></line>`
    : '';
  const innerEnd = type === 'end' && !hasDescription
    ? `<rect x="${x + 5}" y="${y + 5}" width="${width - 10}" height="${height - 10}" rx="${Math.max(0, Math.min(width, height) / 2 - 5)}" fill="none" stroke="${escapeSvg(colors.dangerBorder)}" stroke-width="1"></rect>`
    : '';
  const centered = type === 'decision' && !hasDescription;
  const textX = centered ? centerX : x + (rounded ? 20 : 14);
  const textAnchor = centered ? 'middle' : 'start';
  const typeColor = type === 'start' ? colors.green : type === 'decision' ? colors.amber : type === 'end' ? colors.red : colors.accentText;
  const labelMaxCharacters = centered
    ? Math.max(12, Math.floor(width / (10 * fontScale)))
    : rounded
      ? Math.max(15, Math.floor((width - 40) / (7.3 * fontScale)))
      : Math.max(18, Math.floor((width - 14) / (7.3 * fontScale)));
  const labelLines = wrapSvgText(node.label, labelMaxCharacters, hasDescription ? 2 : 3);
  const typeMarkup = svgTextLines([NODE_TYPES[type] || NODE_TYPES.step], {
    x: textX,
    y: y + (hasDescription ? 22 : centered ? 27 : 22),
    anchor: textAnchor,
    fill: typeColor,
    fontSize: typeFontSize,
    weight: 700,
    lineHeight: typeLineHeight
  });
  const labelMarkup = svgTextLines(labelLines, {
    x: textX,
    y: y + (hasDescription ? 46 : centered ? 48 : 46),
    anchor: textAnchor,
    fill: colors.strong,
    fontSize: labelFontSize,
    weight: 650,
    lineHeight: labelLineHeight
  });
  const descriptionMarkup = hasDescription
    ? (() => {
      const descriptionX = textX;
      const descriptionTitleY = y + 46 + labelLines.length * labelLineHeight + 18 * fontScale;
      const description = String(node.description || '').trim() || 'Añade detalles…';
      const descriptionLines = wrapSvgText(description, Math.max(18, Math.floor((width - 28) / (6.2 * fontScale))), 4);
      return `${svgTextLines(['DESCRIPCIÓN'], { x: descriptionX, y: descriptionTitleY, anchor: textAnchor, fill: colors.accentTextSoft, fontSize: descriptionTitleFontSize, weight: 700, lineHeight: descriptionTitleLineHeight })}${svgTextLines(descriptionLines, { x: descriptionX, y: descriptionTitleY + 15 * fontScale, anchor: textAnchor, fill: colors.muted, fontSize: descriptionFontSize, weight: 400, lineHeight: descriptionLineHeight })}`;
    })()
    : '';
  const accessibleLabel = hasDescription && node.description
    ? `${node.label}. ${node.description}`
    : node.label;
  return `<g aria-label="${escapeSvg(accessibleLabel)}">${shape}${innerEnd}${accent}${typeMarkup}${labelMarkup}${descriptionMarkup}</g>`;
}

function diagramEdgeSvg(edge, diagram, colors, index = 0) {
  const geometry = edgeGeometry(edge, diagram, false);
  if (!geometry) return '';
  const fontScale = currentDiagramFontScale();
  const direction = validEdgeDirection(edge.direction);
  const edgeColorKey = validEdgeColor(edge.color) || edgeColorForIndex(index);
  const edgeColor = colors.edgeColors?.[edgeColorKey] || colors.accentTextSoft;
  const markerId = direction === 'forward'
    ? `diagram-image-arrow-forward-${index}`
    : direction === 'backward'
      ? `diagram-image-arrow-backward-${index}`
      : '';
  const marker = markerId
    ? direction === 'forward'
      ? ` marker-end="url(#${markerId})"`
      : ` marker-start="url(#${markerId})"`
    : '';
  const markerDefinition = markerId
    ? `<defs><marker id="${markerId}" markerWidth="14" markerHeight="14" refX="12" refY="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M 0 0 L 12 7 L 0 14 z" fill="${escapeSvg(edgeColor)}"></path></marker></defs>`
    : '';
  const dash = direction === 'none' ? ' stroke-dasharray="7 5"' : '';
  const endpointMarkup = direction === 'forward'
    ? `<circle cx="${geometry.start.x}" cy="${geometry.start.y}" r="5" fill="${escapeSvg(colors.cyan)}" stroke="${escapeSvg(colors.canvas)}" stroke-width="2.5"></circle>`
    : direction === 'backward'
      ? `<circle cx="${geometry.end.x}" cy="${geometry.end.y}" r="5" fill="${escapeSvg(colors.amber)}" stroke="${escapeSvg(colors.canvas)}" stroke-width="2.5"></circle>`
      : `<circle cx="${geometry.start.x}" cy="${geometry.start.y}" r="5" fill="${escapeSvg(colors.canvas)}" stroke="${escapeSvg(colors.accentTextSoft)}" stroke-width="2.5"></circle><circle cx="${geometry.end.x}" cy="${geometry.end.y}" r="5" fill="${escapeSvg(colors.canvas)}" stroke="${escapeSvg(colors.accentTextSoft)}" stroke-width="2.5"></circle>`;
  const label = edge.label
    ? `<text x="${geometry.midpoint.x}" y="${geometry.midpoint.y}" text-anchor="middle" dominant-baseline="middle" fill="${escapeSvg(colors.accentTextSoft)}" paint-order="stroke" stroke="${escapeSvg(colors.surfaceDeep)}" stroke-width="5" font-family="ui-monospace, SFMono-Regular, Consolas, monospace" font-size="${10 * fontScale}">${escapeSvg(edge.label)}</text>`
    : '';
  return `<g>${markerDefinition}<path d="${geometry.path}" fill="none" stroke="${escapeSvg(colors.canvas)}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"></path><path d="${geometry.path}" fill="none" stroke="${escapeSvg(edgeColor)}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"${dash}${marker}></path>${endpointMarkup}${label}</g>`;
}

function createDiagramImageSvg(diagram) {
  const colors = diagramImageColors();
  const safeDiagram = diagram || { title: 'Diagrama', nodes: [], edges: [] };
  const edges = Array.isArray(safeDiagram.edges) ? safeDiagram.edges.map((edge, index) => diagramEdgeSvg(edge, safeDiagram, colors, index)).join('') : '';
  const nodes = Array.isArray(safeDiagram.nodes) ? safeDiagram.nodes.map((node) => diagramNodeSvg(node, colors)).join('') : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${BOARD_WIDTH}" height="${BOARD_HEIGHT}" viewBox="0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}" role="img" aria-labelledby="diagram-image-title"><title id="diagram-image-title">${escapeSvg(safeDiagram.title || 'Diagrama')}</title><defs><pattern id="diagram-image-grid" width="${DIAGRAM_GRID_SIZE}" height="${DIAGRAM_GRID_SIZE}" patternUnits="userSpaceOnUse"><path d="M ${DIAGRAM_GRID_SIZE} 0 L 0 0 0 ${DIAGRAM_GRID_SIZE}" fill="none" stroke="${escapeSvg(colors.gridLine)}" stroke-width="1"></path></pattern><filter id="diagram-image-shadow" x="-20%" y="-30%" width="140%" height="170%"><feDropShadow dx="0" dy="4" stdDeviation="4" flood-color="#000000" flood-opacity=".3"></feDropShadow></filter><marker id="diagram-image-arrow-forward" markerWidth="14" markerHeight="14" refX="12" refY="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M 0 0 L 12 7 L 0 14 z" fill="${escapeSvg(colors.blue)}"></path></marker><marker id="diagram-image-arrow-backward" markerWidth="14" markerHeight="14" refX="12" refY="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M 0 0 L 12 7 L 0 14 z" fill="${escapeSvg(colors.purple)}"></path></marker></defs><rect width="${BOARD_WIDTH}" height="${BOARD_HEIGHT}" fill="${escapeSvg(colors.canvas)}"></rect><rect width="${BOARD_WIDTH}" height="${BOARD_HEIGHT}" fill="url(#diagram-image-grid)"></rect><g aria-label="Conexiones">${edges}</g><g aria-label="Nodos">${nodes}</g></svg>`;
}

function canvasToPngDataUrl(canvas) {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== 'function') {
      try {
        resolve(canvas.toDataURL('image/png'));
      } catch (error) {
        reject(new Error(error.message || 'No se pudo crear la imagen del diagrama'));
      }
      return;
    }
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('No se pudo crear la imagen del diagrama'));
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('No se pudo preparar la imagen del diagrama'));
      reader.readAsDataURL(blob);
    }, 'image/png');
  });
}

function syncCanvasContextMenu() {
  const menu = $('#diagram-canvas-context-menu');
  if (!menu) return;
  const toggle = menu.querySelector('[data-canvas-action="toggle-connect"]');
  if (toggle) toggle.textContent = connectMode ? 'Desactivar modo conexión' : 'Activar modo conexión';
}

function svgToPngDataUrl(svg) {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || typeof document === 'undefined' || typeof window.Blob !== 'function' || typeof window.URL?.createObjectURL !== 'function' || typeof window.Image !== 'function') {
      reject(new Error('La exportación de imágenes no está disponible'));
      return;
    }
    const objectUrl = window.URL.createObjectURL(new window.Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    const image = new window.Image();
    const cleanup = () => window.URL.revokeObjectURL(objectUrl);
    image.onload = async () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = BOARD_WIDTH * DIAGRAM_IMAGE_SCALE;
        canvas.height = BOARD_HEIGHT * DIAGRAM_IMAGE_SCALE;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('El navegador no permite crear un lienzo de imagen');
        context.imageSmoothingEnabled = true;
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(await canvasToPngDataUrl(canvas));
      } catch (error) {
        reject(new Error(error.message || 'No se pudo crear la imagen del diagrama'));
      } finally {
        cleanup();
      }
    };
    image.onerror = () => {
      cleanup();
      reject(new Error('No se pudo dibujar el diagrama como imagen'));
    };
    image.src = objectUrl;
  });
}

async function exportDiagramImage(button = null) {
  const originalText = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = 'Exportando…';
  }
  try {
    if (typeof window.nexusData?.saveDiagramFile !== 'function') throw new Error('La exportación de diagramas no está disponible');
    const dataUrl = await svgToPngDataUrl(createDiagramImageSvg(activeDiagram()));
    const savedPath = await window.nexusData.saveDiagramFile({ content: dataUrl, format: 'png' });
    if (savedPath) showToast(`Diagrama exportado: ${fileNameFromPath(savedPath)}`);
  } catch (error) {
    showToast(error.message || 'No se pudo exportar la imagen del diagrama', true);
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText;
    }
  }
}

function handleBoardDoubleClick(event) {
  if (event.target.closest('.diagram-node, [data-edge-id]')) return;
  addNodeAt(boardPoint(event));
}

function handlePointerMove(event) {
  if (connectionDrag && connectionDrag.pointerId === event.pointerId) {
    const distance = Math.hypot(event.clientX - connectionDrag.startX, event.clientY - connectionDrag.startY);
    if (!connectionDrag.moved && distance < 5) return;
    if (!connectionDrag.moved) {
      connectionDrag.moved = true;
      connectMode = true;
      connectionStart = connectionDrag.source;
      setSelection('node', connectionDrag.source.nodeId);
    }
    const board = $('#diagram-board');
    if (board) {
      connectionDrag.current = boardPoint(event);
      connectionDrag.target = targetConnectionFromPoint(event);
      renderEdges(activeDiagram());
    }
    return;
  }
  if (resizeState && resizeState.pointerId === event.pointerId) {
    const diagram = activeDiagram();
    const node = nodeById(diagram, resizeState.id);
    const board = $('#diagram-board');
    if (!node || !board) return;
    const boardRect = board.getBoundingClientRect();
    const scaleX = boardRect.width ? boardRect.width / BOARD_WIDTH : 1;
    const scaleY = boardRect.height ? boardRect.height / BOARD_HEIGHT : 1;
    const distance = Math.hypot(event.clientX - resizeState.startX, event.clientY - resizeState.startY);
    if (!resizeState.moved && distance < 5) return;
    resizeState.moved = true;
    event.preventDefault();
    const maxWidth = Math.min(NODE_MAX_WIDTH, BOARD_WIDTH - node.x - NODE_MARGIN);
    const maxHeight = Math.min(NODE_MAX_HEIGHT, BOARD_HEIGHT - node.y - NODE_MARGIN);
    node.width = Math.round(clamp(resizeState.startWidth + (event.clientX - resizeState.startX) / scaleX, NODE_MIN_WIDTH, maxWidth));
    node.height = Math.round(clamp(resizeState.startHeight + (event.clientY - resizeState.startY) / scaleY, NODE_MIN_HEIGHT, maxHeight));
    const element = document.querySelector(`[data-node-id="${node.id}"]`);
    if (element) {
      element.style.width = `${node.width}px`;
      element.style.height = `${node.height}px`;
    }
    renderEdges(diagram);
    return;
  }
  if (panState && panState.pointerId === event.pointerId) {
    const distance = Math.hypot(event.clientX - panState.startX, event.clientY - panState.startY);
    if (!panState.moved && distance < 5) return;
    panState.moved = true;
    event.preventDefault();
    diagramViewport.offsetX = panState.startOffsetX + event.clientX - panState.startX;
    diagramViewport.offsetY = panState.startOffsetY + event.clientY - panState.startY;
    diagramViewport.userZoomed = true;
    applyDiagramViewport();
    return;
  }
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  const diagram = activeDiagram();
  const node = nodeById(diagram, dragState.id);
  const board = $('#diagram-board');
  if (!node || !board) return;
  const distance = Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY);
  if (!dragState.moved && distance < 5) return;
  dragState.moved = true;
  event.preventDefault();
  const point = boardPoint(event);
  node.x = clamp(point.x - dragState.offsetX, NODE_MARGIN, BOARD_WIDTH - nodeWidth(node) - NODE_MARGIN);
  node.y = clamp(point.y - dragState.offsetY, NODE_MARGIN, BOARD_HEIGHT - nodeHeight(node) - NODE_MARGIN);
  const element = document.querySelector(`[data-node-id="${node.id}"]`);
  if (element) element.style.transform = `translate(${node.x}px, ${node.y}px)`;
  renderEdges(diagram);
}

function handlePointerUp(event) {
  if (connectionDrag && connectionDrag.pointerId === event.pointerId) {
    finishConnectionDrag(event);
    return;
  }
  if (resizeState && resizeState.pointerId === event.pointerId) {
    if (resizeState.moved) recordHistory(resizeState.historyBefore);
    resizeState = null;
    persistDiagrams();
    return;
  }
  if (panState && panState.pointerId === event.pointerId) {
    if (panState.moved) event.preventDefault();
    $('#diagram-canvas')?.classList.remove('is-panning');
    panState = null;
    return;
  }
  if (!dragState || dragState.pointerId !== event.pointerId) return;
  if (dragState.moved) lastDraggedNode = { id: dragState.id, timestamp: Date.now() };
  if (dragState.moved) recordHistory(dragState.historyBefore);
  dragState = null;
  persistDiagrams();
}

function handlePointerCancel(event) {
  if (connectionDrag && connectionDrag.pointerId === event.pointerId) {
    connectionDrag = null;
    connectionStart = null;
    renderEdges(activeDiagram());
    updateSelectionUI();
    return;
  }
  handlePointerUp(event);
}

function handleKeydown(event) {
  const isTextControl = event.target.closest?.('input, textarea, select');
  const hasModifier = event.metaKey || event.ctrlKey;
  const key = event.key.toLowerCase();
  const zoomIn = event.key === '+' || event.key === '=' || event.code === 'Equal';
  const zoomOut = event.key === '-' || event.key === '_' || event.code === 'Minus';
  if (hasModifier && !event.altKey && !isTextControl && zoomIn) {
    event.preventDefault();
    zoomDiagramByFactor(DIAGRAM_ZOOM_STEP);
    return;
  }
  if (hasModifier && !event.altKey && !isTextControl && zoomOut) {
    event.preventDefault();
    zoomDiagramByFactor(1 / DIAGRAM_ZOOM_STEP);
    return;
  }
  if (hasModifier && !event.altKey && !isTextControl && key === 'z') {
    event.preventDefault();
    if (event.shiftKey) redoDiagramChange();
    else undoDiagramChange();
    return;
  }
  if (event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !isTextControl && key === 'y') {
    event.preventDefault();
    redoDiagramChange();
    return;
  }
  if (event.key === 'Escape' && (contextMenuEdgeId || contextMenuNodeId || contextMenuCanvasPoint)) {
    event.preventDefault();
    hideEdgeContextMenu();
    return;
  }
  if (event.key === 'Escape' && (connectMode || connectionAnchorNodeId)) {
    connectionStart = null;
    connectMode = false;
    connectionAnchorNodeId = '';
    updateSelectionUI();
    return;
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && !event.target.closest('input, textarea, select')) {
    event.preventDefault();
    removeSelection();
  }
}

function bindDiagramEvents(root) {
  const diagram = activeDiagram();
  $('#diagram-title').addEventListener('input', (event) => {
    beginTextHistory(event.target);
    diagram.title = event.target.value.slice(0, 120);
    persistDiagrams();
  });
  $('#diagram-select').addEventListener('change', (event) => {
    activeDiagramId = event.target.value;
    selection = { type: '', id: '' };
    connectionStart = null;
    connectionAnchorNodeId = '';
    connectMode = false;
    renderDiagrams();
  });
  const nodeLayer = $('#diagram-node-layer');
  nodeLayer.addEventListener('pointerdown', handleNodePointerDown);
  nodeLayer.addEventListener('click', handleNodeClick);
  nodeLayer.addEventListener('dblclick', handleNodeDoubleClick);
  nodeLayer.addEventListener('contextmenu', handleNodeContextMenu);
  nodeLayer.addEventListener('input', handleNodeInput);
  const edgeLayer = $('#diagram-edge-layer');
  edgeLayer.addEventListener('click', handleEdgeClick);
  edgeLayer.addEventListener('dblclick', handleEdgeDoubleClick);
  edgeLayer.addEventListener('contextmenu', handleEdgeContextMenu);
  $('#diagram-context-menu').addEventListener('click', handleEdgeContextMenuAction);
  $('#diagram-node-context-menu').addEventListener('click', handleNodeContextMenuAction);
  $('#diagram-canvas-context-menu').addEventListener('click', handleCanvasContextMenuAction);
  const canvas = $('#diagram-canvas');
  canvas.addEventListener('wheel', handleDiagramWheel, { passive: false });
  canvas.addEventListener('pointerdown', beginDiagramPan);
  canvas.addEventListener('contextmenu', showCanvasContextMenu);
  const board = $('#diagram-board');
  board.addEventListener('pointerdown', handleBoardPointerDown);
  board.addEventListener('dblclick', handleBoardDoubleClick);
  root.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.diagram-context-menu')) hideEdgeContextMenu();
  });
  root.addEventListener('pointermove', handlePointerMove);
  root.addEventListener('pointerup', handlePointerUp);
  root.addEventListener('pointercancel', handlePointerCancel);
  root.addEventListener('focusout', (event) => finishTextHistory(event.target));
  if (!diagramKeyboardBound) {
    diagramKeyboardBound = true;
    document.addEventListener('keydown', (event) => {
      if ($('#view-diagrams')?.classList.contains('active')) handleKeydown(event);
    });
  }
}
