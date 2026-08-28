import { $, escapeHtml } from '../core/dom.js';
import { showToast } from '../ui/notifications.js';
import { bindModalClose, closeModal } from '../ui/modals.js';
import { parseDiagramText, serializeDiagram } from './diagram-language.mjs';

const STORAGE_KEY = 'nexusdata.diagrams.v1';
const BOARD_WIDTH = 1400;
const BOARD_HEIGHT = 900;
const NODE_WIDTH = 190;
const NODE_HEIGHT = 88;
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
let connectionDrag = null;
let suppressedPortKeys = new Set();
let dragState = null;
let lastDraggedNode = { id: '', timestamp: 0 };
let focusNodeId = null;
let contextMenuEdgeId = '';
let contextMenuNodeId = '';
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

function validNodeType(type) {
  return Object.prototype.hasOwnProperty.call(NODE_TYPES, type) ? type : 'step';
}

function validEdgeDirection(direction) {
  return Object.prototype.hasOwnProperty.call(EDGE_DIRECTIONS, direction) ? direction : 'forward';
}

function createDiagram(title = 'Nuevo diagrama') {
  return { id: makeId('diagram'), title, nodes: [], edges: [] };
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
  usedIds.add(id);
  return {
    id,
    label: typeof raw?.label === 'string' && raw.label.trim() ? raw.label.slice(0, 160) : `Paso ${index + 1}`,
    type: validNodeType(raw?.type),
    x: clamp(Number.isFinite(Number(raw?.x)) ? Number(raw.x) : fallbackPosition.x, NODE_MARGIN, BOARD_WIDTH - NODE_WIDTH - NODE_MARGIN),
    y: clamp(Number.isFinite(Number(raw?.y)) ? Number(raw.y) : fallbackPosition.y, NODE_MARGIN, BOARD_HEIGHT - NODE_HEIGHT - NODE_MARGIN)
  };
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
    direction: validEdgeDirection(raw?.direction)
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

function applyDiagramText(text, { successMessage = 'Diagrama generado desde texto' } = {}) {
  const parsed = parseDiagramText(text);
  const current = activeDiagram();
  const before = historySnapshot();
  const index = Math.max(0, diagrams.findIndex((diagram) => diagram.id === current.id));
  const next = normaliseDiagram({ ...parsed, id: current.id }, index);
  diagrams = diagrams.map((diagram) => diagram.id === current.id ? next : diagram);
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
  applyDiagramText(diagramDocument.content, { successMessage: 'Diagrama abierto visualmente' });
  closeModal();
}

function setDiagramCodeError(node, message = '') {
  if (!node) return;
  node.textContent = message;
  node.hidden = !message;
}

function openDiagramCodeModal(initialText = serializeDiagram(activeDiagram()), sourcePath = '') {
  const sourceName = sourcePath ? fileNameFromPath(sourcePath) : 'Diagrama activo';
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><div class="modal diagram-code-modal" role="dialog" aria-modal="true" aria-labelledby="diagram-code-title"><div class="modal-head"><div><h2 id="diagram-code-title">Código del diagrama</h2><p>Escribe o revisa el lenguaje textual y genera el diagrama seleccionado.</p></div><button class="modal-close" data-close-modal aria-label="Cerrar">×</button></div><div class="modal-body diagram-code-body"><div class="diagram-code-source">Origen: <strong id="diagram-code-source">${escapeHtml(sourceName)}</strong></div><textarea id="diagram-code-editor" class="diagram-code-editor" aria-label="Código textual del diagrama" spellcheck="false">${escapeHtml(initialText)}</textarea><div id="diagram-code-error" class="diagram-code-error" role="alert" hidden></div><p class="diagram-code-hint">Usa <code>diagram</code>, <code>node</code> y <code>edge</code>. La guía completa está en <code>docs/diagramas-por-texto.md</code>.</p></div><div class="modal-actions"><button id="diagram-code-import" class="btn btn-secondary" type="button">Importar archivo</button><button id="diagram-code-copy" class="btn btn-secondary" type="button">Copiar</button><button id="diagram-code-export" class="btn btn-secondary" type="button">Exportar archivo</button><button class="btn btn-secondary" data-close-modal type="button">Cancelar</button><button id="diagram-code-apply" class="btn btn-primary" type="button">Generar diagrama</button></div></div></div>`;
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
    if (action === 'import') importDiagramFile();
    if (action === 'export') exportDiagramText(serializeDiagram(activeDiagram()));
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
  selection = { type: '', id: '' };
  connectMode = false;
  connectionStart = null;
  connectionDrag = null;
  dragState = null;
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
  let diagram = diagrams.find((candidate) => candidate.id === activeDiagramId);
  if (!diagram) {
    diagram = diagrams[0] || createDiagram('Flujo principal');
    if (!diagrams.length) diagrams = [diagram];
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

function hideEdgeContextMenu() {
  const menu = $('#diagram-context-menu');
  if (menu) {
    menu.hidden = true;
    menu.setAttribute('aria-hidden', 'true');
  }
  contextMenuEdgeId = '';
  hideNodeContextMenu();
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
  const option = event.target.closest?.('[data-edge-direction]');
  if (!option) return;
  event.preventDefault();
  event.stopPropagation();
  changeEdgeDirection(option.dataset.edgeDirection);
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

function focusNodeLabel(nodeId) {
  const input = [...document.querySelectorAll('[data-node-label]')]
    .find((element) => element.dataset.nodeLabel === nodeId);
  if (!input) return;
  input.focus();
  input.select();
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
  if (option.dataset.nodeAction === 'delete') {
    const node = nodeById(activeDiagram(), nodeId);
    hideEdgeContextMenu();
    if (node) {
      removeNode(node.id);
      showToast('Tarjeta eliminada');
    }
  }
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
  return {
    x: node.x + NODE_WIDTH * port.x,
    y: node.y + NODE_HEIGHT * port.y
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

function edgeGeometry(edge, diagram) {
  const sourceNode = nodeById(diagram, edge.source.nodeId);
  const targetNode = nodeById(diagram, edge.target.nodeId);
  if (!sourceNode || !targetNode) return null;
  return directionalGeometry(
    nodePoint(sourceNode, edge.source.port),
    nodePoint(targetNode, edge.target.port),
    edge.source.port,
    edge.target.port,
    validEdgeDirection(edge.direction)
  );
}

function nodeMarkup(node) {
  const typeLabel = NODE_TYPES[node.type] || NODE_TYPES.step;
  const ports = Object.entries(PORTS).map(([port, value]) => `<button class="diagram-port diagram-port-${port}" type="button" data-diagram-port data-node-id="${escapeHtml(node.id)}" data-port="${port}" aria-label="Conectar por el punto de ${value.label}"></button>`).join('');
  return `<article class="diagram-node diagram-node-${node.type}${selection.type === 'node' && selection.id === node.id ? ' is-selected' : ''}" data-node-id="${escapeHtml(node.id)}" style="transform: translate(${node.x}px, ${node.y}px);"><div class="diagram-node-surface"><div class="diagram-node-topline"><span class="diagram-node-type">${escapeHtml(typeLabel)}</span><button class="diagram-node-delete" type="button" data-delete-node="${escapeHtml(node.id)}" aria-label="Eliminar nodo">×</button></div><input class="diagram-node-label" data-node-label="${escapeHtml(node.id)}" value="${escapeHtml(node.label)}" aria-label="Etiqueta del nodo" maxlength="160" /></div>${ports}</article>`;
}

function renderNodes(diagram) {
  const layer = $('#diagram-node-layer');
  if (layer) layer.innerHTML = diagram.nodes.map(nodeMarkup).join('');
}

function renderEdges(diagram) {
  const layer = $('#diagram-edge-paths');
  if (!layer) return;
  const edgesMarkup = diagram.edges.map((edge) => {
    const geometry = edgeGeometry(edge, diagram);
    if (!geometry) return '';
    const selected = selection.type === 'edge' && selection.id === edge.id ? ' is-selected' : '';
    const direction = validEdgeDirection(edge.direction);
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
    const label = edge.label ? `<text class="diagram-edge-label" x="${geometry.midpoint.x}" y="${geometry.midpoint.y}" text-anchor="middle">${escapeHtml(edge.label)}</text>` : '';
    return `<g class="diagram-edge-group${selected}" data-edge-direction="${direction}"><path class="diagram-edge-backplate" d="${geometry.path}"></path><path class="diagram-edge${selected}" d="${geometry.path}" data-edge-direction="${direction}"${marker}></path>${endpointMarkup}<path class="diagram-edge-hit" d="${geometry.path}" data-edge-id="${escapeHtml(edge.id)}" tabindex="0" role="button" aria-label="Seleccionar conexión"></path>${label}</g>`;
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
}

function renderInspector() {
  const container = $('#diagram-inspector');
  if (!container) return;
  const diagram = activeDiagram();
  if (selection.type === 'node') {
    const node = nodeById(diagram, selection.id);
    if (node) {
      container.innerHTML = `<div class="diagram-inspector-card"><span class="diagram-inspector-kicker">NODO SELECCIONADO</span><label class="form-label">Etiqueta<input id="diagram-inspector-label" class="field" value="${escapeHtml(node.label)}" maxlength="160" /></label><label class="form-label">Tipo<select id="diagram-inspector-type" class="select"><option value="start"${node.type === 'start' ? ' selected' : ''}>Inicio</option><option value="step"${node.type === 'step' ? ' selected' : ''}>Paso</option><option value="decision"${node.type === 'decision' ? ' selected' : ''}>Decisión</option><option value="end"${node.type === 'end' ? ' selected' : ''}>Fin</option></select></label><p class="form-note">Arrastra la tarjeta para moverla. Usa cualquiera de sus cuatro puntos para conectarla.</p></div>`;
      $('#diagram-inspector-label').addEventListener('input', (event) => {
        beginTextHistory(event.target);
        node.label = event.target.value.slice(0, 160);
        const nodeInput = document.querySelector(`[data-node-label="${node.id}"]`);
        if (nodeInput && nodeInput !== event.target) nodeInput.value = node.label;
        persistDiagrams();
      });
      $('#diagram-inspector-type').addEventListener('change', (event) => {
        const before = historySnapshot();
        node.type = validNodeType(event.target.value);
        recordHistory(before);
        persistDiagrams();
        renderDiagrams();
      });
      return;
    }
  }
  if (selection.type === 'edge') {
    const edge = edgeById(diagram, selection.id);
    if (edge) {
      container.innerHTML = `<div class="diagram-inspector-card"><span class="diagram-inspector-kicker">CONEXIÓN SELECCIONADA</span><label class="form-label">Texto de la línea<input id="diagram-inspector-edge-label" class="field" value="${escapeHtml(edge.label)}" maxlength="120" placeholder="Opcional" /></label><div class="diagram-edge-direction"><span>Dirección</span><strong>${escapeHtml(EDGE_DIRECTIONS[validEdgeDirection(edge.direction)])}</strong></div><p class="form-note">Haz clic derecho sobre la línea para cambiar entre línea simple o flecha hacia cualquiera de los dos sentidos.</p></div>`;
      $('#diagram-inspector-edge-label').addEventListener('input', (event) => {
        beginTextHistory(event.target);
        edge.label = event.target.value.slice(0, 120);
        persistDiagrams();
        renderEdges(diagram);
      });
      return;
    }
  }
  container.innerHTML = '<div class="diagram-inspector-empty"><strong>Sin selección</strong><p>Crea un nodo con el botón “＋ Nodo” o haciendo doble clic en el lienzo.</p></div>';
}

function updateStatus() {
  const diagram = activeDiagram();
  const status = $('#diagram-status');
  if (!status) return;
  if (connectMode && connectionStart) {
    const node = nodeById(diagram, connectionStart.nodeId);
    status.textContent = `Conectando desde “${node?.label || 'nodo'}”. Selecciona el punto de destino.`;
  } else if (connectMode) {
    status.textContent = 'Modo conexión activo. Selecciona un punto de origen.';
  } else if (selection.type === 'node') {
    status.textContent = 'Nodo seleccionado. Puedes editar su etiqueta o tipo.';
  } else if (selection.type === 'edge') {
    status.textContent = 'Conexión seleccionada. Puedes editar su texto o cambiar la Dirección.';
  } else {
    status.textContent = 'Doble clic en un espacio vacío para añadir un nodo.';
  }
  const count = $('#diagram-count');
  if (count) count.textContent = `${diagram.nodes.length} nodos · ${diagram.edges.length} conexiones`;
}

function updateSelectionUI() {
  const root = $('#view-diagrams');
  if (!root) return;
  root.querySelectorAll('.diagram-node').forEach((node) => node.classList.toggle('is-selected', selection.type === 'node' && selection.id === node.dataset.nodeId));
  root.querySelectorAll('.diagram-edge').forEach((edge) => {
    const group = edge.closest('.diagram-edge-group');
    const edgeHit = group?.querySelector('[data-edge-id]');
    edge.classList.toggle('is-selected', selection.type === 'edge' && selection.id === edgeHit?.dataset.edgeId);
  });
  root.querySelectorAll('[data-diagram-port]').forEach((port) => port.classList.toggle('is-source', Boolean(connectionStart && connectionStart.nodeId === port.dataset.nodeId && connectionStart.port === port.dataset.port)));
  const deleteButton = $('#diagram-delete-selection');
  if (deleteButton) deleteButton.disabled = false;
  const connectButton = $('#diagram-connect');
  if (connectButton) {
    connectButton.classList.toggle('is-active', connectMode);
    connectButton.textContent = connectMode ? '✓ Conectar' : '↗ Conectar';
  }
  renderInspector();
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
  hideEdgeContextMenu();
  const diagram = activeDiagram();
  root.innerHTML = `<div class="diagram-shell"><header class="diagram-toolbar"><div class="diagram-title-wrap"><span class="diagram-eyebrow">DIAGRAMAS</span><input id="diagram-title" class="diagram-title" value="${escapeHtml(diagram.title)}" maxlength="120" aria-label="Nombre del diagrama" /></div><div class="diagram-toolbar-actions"><label class="diagram-select-wrap"><span>Documento</span><select id="diagram-select" class="diagram-select">${diagrams.map((item) => `<option value="${escapeHtml(item.id)}"${item.id === diagram.id ? ' selected' : ''}>${escapeHtml(item.title)}</option>`).join('')}</select></label><button id="diagram-new" class="btn btn-secondary" type="button">＋ Nuevo</button><button id="diagram-add-node" class="btn btn-primary" type="button">＋ Nodo</button><button id="diagram-code" class="btn btn-secondary" type="button">⌘ Código</button><button id="diagram-connect" class="btn btn-secondary${connectMode ? ' is-active' : ''}" type="button">${connectMode ? '✓ Conectar' : '↗ Conectar'}</button><button id="diagram-delete-selection" class="btn btn-danger" type="button" disabled>Eliminar</button></div></header><div class="diagram-main"><div class="diagram-canvas" id="diagram-canvas"><div class="diagram-board" id="diagram-board" style="width: ${BOARD_WIDTH}px; height: ${BOARD_HEIGHT}px;"><svg id="diagram-edge-layer" class="diagram-edge-layer" viewBox="0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}" aria-label="Conexiones del diagrama"><defs><marker id="diagram-arrow" markerWidth="14" markerHeight="14" refX="12" refY="7" orient="auto-start-reverse" markerUnits="userSpaceOnUse"><path d="M 0 0 L 12 7 L 0 14 z" fill="currentColor"></path></marker><marker id="diagram-arrow-preview" markerWidth="14" markerHeight="14" refX="12" refY="7" orient="auto" markerUnits="userSpaceOnUse"><path d="M 0 0 L 12 7 L 0 14 z" fill="currentColor"></path></marker></defs><g id="diagram-edge-paths"></g></svg><div id="diagram-node-layer" class="diagram-node-layer"></div><div id="diagram-empty-hint" class="diagram-empty-hint"><strong>Empieza tu flujo</strong><span>Añade un nodo o haz doble clic en el lienzo</span></div></div></div></div></div>`;
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
  root.insertAdjacentHTML('beforeend', '<div id="diagram-context-menu" class="diagram-context-menu" role="menu" aria-label="Dirección de la conexión" aria-hidden="true" hidden><div class="diagram-context-menu-heading">Dirección</div><button type="button" role="menuitemradio" data-edge-direction="none" aria-checked="false">Línea simple</button><button type="button" role="menuitemradio" data-edge-direction="forward" aria-checked="false">→ Hacia el destino</button><button type="button" role="menuitemradio" data-edge-direction="backward" aria-checked="false">← Hacia el origen</button></div><div id="diagram-node-context-menu" class="diagram-context-menu" role="menu" aria-label="Modificar tarjeta" aria-hidden="true" hidden><div class="diagram-context-menu-heading">Tarjeta</div><button type="button" role="menuitem" data-node-action="focus-label">Editar etiqueta</button><div class="diagram-context-menu-heading">Tipo</div><button type="button" role="menuitemradio" data-node-type="start" aria-checked="false">Inicio</button><button type="button" role="menuitemradio" data-node-type="step" aria-checked="false">Paso</button><button type="button" role="menuitemradio" data-node-type="decision" aria-checked="false">Decisión</button><button type="button" role="menuitemradio" data-node-type="end" aria-checked="false">Fin</button><button type="button" role="menuitem" data-node-action="delete">Eliminar tarjeta</button></div>');
  bindDiagramEvents(root);
  renderDiagramCanvas();
  updateSelectionUI();
  if (focusNodeId) {
    const nodeId = focusNodeId;
    focusNodeId = null;
    requestAnimationFrame(() => document.querySelector(`[data-node-label="${nodeId}"]`)?.focus());
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
  return diagram.nodes.every((node) => (
    x + NODE_WIDTH + NODE_MARGIN <= node.x
    || node.x + NODE_WIDTH + NODE_MARGIN <= x
    || y + NODE_HEIGHT + NODE_MARGIN <= node.y
    || node.y + NODE_HEIGHT + NODE_MARGIN <= y
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
    y: position.y
  };
  diagram.nodes.push(node);
  selection = { type: 'node', id: node.id };
  focusNodeId = node.id;
  recordHistory(before);
  persistDiagrams();
  renderDiagrams();
}

function removeNode(nodeId) {
  const diagram = activeDiagram();
  const before = historySnapshot();
  diagram.nodes = diagram.nodes.filter((node) => node.id !== nodeId);
  diagram.edges = diagram.edges.filter((edge) => edge.source.nodeId !== nodeId && edge.target.nodeId !== nodeId);
  if (selection.id === nodeId) selection = { type: '', id: '' };
  if (connectionStart?.nodeId === nodeId) connectionStart = null;
  recordHistory(before);
  persistDiagrams();
  renderDiagrams();
}

function removeSelection() {
  const diagram = activeDiagram();
  if (selection.type === 'node' && selection.id) {
    removeNode(selection.id);
    return;
  }
  if (selection.type === 'edge' && selection.id) {
    const before = historySnapshot();
    diagram.edges = diagram.edges.filter((edge) => edge.id !== selection.id);
    selection = { type: '', id: '' };
    recordHistory(before);
    persistDiagrams();
    renderDiagrams();
  }
}

function deleteActiveDiagram() {
  const current = activeDiagram();
  const before = historySnapshot();
  const deletedIndex = diagrams.findIndex((diagram) => diagram.id === current.id);
  diagrams = diagrams.filter((diagram) => diagram.id !== current.id);
  const nextDiagram = diagrams[deletedIndex] || diagrams[deletedIndex - 1] || createDiagram('Flujo principal');
  if (!diagrams.length) diagrams = [nextDiagram];
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

function commitConnection(source, target) {
  if (!source || !target) return false;
  if (source.nodeId === target.nodeId) {
    showToast('Selecciona un punto de otro nodo para crear la conexión', true);
    return false;
  }
  const diagram = activeDiagram();
  const before = historySnapshot();
  const edge = { id: makeId('edge'), source, target, label: '', direction: 'forward' };
  diagram.edges.push(edge);
  connectionStart = null;
  selection = { type: 'edge', id: edge.id };
  recordHistory(before);
  persistDiagrams();
  renderDiagrams();
  showToast('Conexión creada');
  return true;
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
  const port = event.target.closest('[data-diagram-port]');
  if (port && event.button === 0) {
    beginConnectionDrag(event, port);
    return;
  }
  const element = event.target.closest('.diagram-node');
  if (!element || event.button !== 0) return;
  setSelection('node', element.dataset.nodeId);
  if (event.target.closest('input, button')) return;
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
    removeNode(deleteButton.dataset.deleteNode);
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
  const input = event.target.closest('[data-node-label]');
  if (!input) return;
  const node = nodeById(activeDiagram(), input.dataset.nodeLabel);
  if (!node) return;
  beginTextHistory(input);
  node.label = input.value.slice(0, 160);
  persistDiagrams();
  if (selection.type === 'node' && selection.id === node.id) {
    const inspectorInput = $('#diagram-inspector-label');
    if (inspectorInput && inspectorInput !== input) inspectorInput.value = node.label;
    updateStatus();
  }
}

function handleEdgeClick(event) {
  const hit = event.target.closest('[data-edge-id]');
  if (!hit) return;
  event.stopPropagation();
  setSelection('edge', hit.dataset.edgeId);
}

function handleEdgeContextMenu(event) {
  const hit = event.target.closest?.('[data-edge-id]');
  if (!hit) return;
  event.preventDefault();
  event.stopPropagation();
  showEdgeContextMenu(event, hit.dataset.edgeId);
}

function handleBoardPointerDown(event) {
  if (event.target === event.currentTarget || event.target.id === 'diagram-edge-layer') setSelection();
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
  node.x = clamp(point.x - dragState.offsetX, NODE_MARGIN, BOARD_WIDTH - NODE_WIDTH - NODE_MARGIN);
  node.y = clamp(point.y - dragState.offsetY, NODE_MARGIN, BOARD_HEIGHT - NODE_HEIGHT - NODE_MARGIN);
  const element = document.querySelector(`[data-node-id="${node.id}"]`);
  if (element) element.style.transform = `translate(${node.x}px, ${node.y}px)`;
  renderEdges(diagram);
}

function handlePointerUp(event) {
  if (connectionDrag && connectionDrag.pointerId === event.pointerId) {
    finishConnectionDrag(event);
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
  if (event.key === 'Escape' && (contextMenuEdgeId || contextMenuNodeId)) {
    event.preventDefault();
    hideEdgeContextMenu();
    return;
  }
  if (event.key === 'Escape' && connectMode) {
    connectionStart = null;
    connectMode = false;
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
    connectMode = false;
    renderDiagrams();
  });
  $('#diagram-new').addEventListener('click', () => {
    const before = historySnapshot();
    const next = createDiagram(`Diagrama ${diagrams.length + 1}`);
    diagrams = [...diagrams, next];
    activeDiagramId = next.id;
    selection = { type: '', id: '' };
    connectionStart = null;
    connectMode = false;
    recordHistory(before);
    persistDiagrams();
    renderDiagrams();
    showToast('Nuevo diagrama creado');
  });
  $('#diagram-add-node').addEventListener('click', () => {
    const canvas = $('#diagram-canvas');
    const point = canvas
      ? boardPointFromCanvasCoordinates(canvas.clientWidth / 2, canvas.clientHeight / 2)
      : { x: BOARD_WIDTH / 2, y: BOARD_HEIGHT / 2 };
    addNodeAt(point);
  });
  $('#diagram-code').addEventListener('click', () => openDiagramCodeModal());
  $('#diagram-connect').addEventListener('click', () => {
    connectMode = !connectMode;
    connectionStart = null;
    updateSelectionUI();
  });
  $('#diagram-delete-selection').addEventListener('click', openDeleteDiagramConfirmation);
  const nodeLayer = $('#diagram-node-layer');
  nodeLayer.addEventListener('pointerdown', handleNodePointerDown);
  nodeLayer.addEventListener('click', handleNodeClick);
  nodeLayer.addEventListener('contextmenu', handleNodeContextMenu);
  nodeLayer.addEventListener('input', handleNodeInput);
  const edgeLayer = $('#diagram-edge-layer');
  edgeLayer.addEventListener('click', handleEdgeClick);
  edgeLayer.addEventListener('contextmenu', handleEdgeContextMenu);
  $('#diagram-context-menu').addEventListener('click', handleEdgeContextMenuAction);
  $('#diagram-node-context-menu').addEventListener('click', handleNodeContextMenuAction);
  const canvas = $('#diagram-canvas');
  canvas.addEventListener('wheel', handleDiagramWheel, { passive: false });
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
