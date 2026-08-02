import { $, escapeHtml } from '../core/dom.js';
import { showToast } from '../ui/notifications.js';

const STORAGE_KEY = 'nexusdata.diagrams.v1';
const BOARD_WIDTH = 1400;
const BOARD_HEIGHT = 900;
const NODE_WIDTH = 190;
const NODE_HEIGHT = 88;
const NODE_MARGIN = 20;
const ARROW_INSET = 18;
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
let undoStack = [];
let redoStack = [];
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

function normaliseNode(raw, index, usedIds) {
  const requestedId = typeof raw?.id === 'string' && raw.id ? raw.id : makeId('node');
  const id = usedIds.has(requestedId) ? makeId('node') : requestedId;
  usedIds.add(id);
  return {
    id,
    label: typeof raw?.label === 'string' && raw.label.trim() ? raw.label.slice(0, 160) : `Paso ${index + 1}`,
    type: validNodeType(raw?.type),
    x: clamp(Number.isFinite(Number(raw?.x)) ? Number(raw.x) : 100 + (index % 4) * 250, NODE_MARGIN, BOARD_WIDTH - NODE_WIDTH - NODE_MARGIN),
    y: clamp(Number.isFinite(Number(raw?.y)) ? Number(raw.y) : 100 + Math.floor(index / 4) * 150, NODE_MARGIN, BOARD_HEIGHT - NODE_HEIGHT - NODE_MARGIN)
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
  restoreHistory(previous, 'Cambio deshecho');
}

function redoDiagramChange() {
  if (!redoStack.length) return;
  const current = historySnapshot();
  const next = redoStack.pop();
  undoStack.push(current);
  restoreHistory(next, 'Cambio rehecho');
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

function hideEdgeContextMenu() {
  const menu = $('#diagram-context-menu');
  if (menu) {
    menu.hidden = true;
    menu.setAttribute('aria-hidden', 'true');
  }
  contextMenuEdgeId = '';
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

function findPortElement(nodeId, portName) {
  return [...document.querySelectorAll('[data-diagram-port]')]
    .find((port) => port.dataset.nodeId === nodeId && port.dataset.port === portName) || null;
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
  const secondControl = { x: end.x - targetPort.dx * distance, y: end.y - targetPort.dy * distance };
  const path = `M ${start.x} ${start.y} C ${firstControl.x} ${firstControl.y}, ${secondControl.x} ${secondControl.y}, ${end.x} ${end.y}`;
  const midpoint = {
    x: 0.125 * start.x + 0.375 * firstControl.x + 0.375 * secondControl.x + 0.125 * end.x,
    y: 0.125 * start.y + 0.375 * firstControl.y + 0.375 * secondControl.y + 0.125 * end.y
  };
  return { path, midpoint };
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
    x: start.x + firstDirection.dx * handle,
    y: start.y + firstDirection.dy * handle
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
    const label = edge.label ? `<text class="diagram-edge-label" x="${geometry.midpoint.x}" y="${geometry.midpoint.y}" text-anchor="middle">${escapeHtml(edge.label)}</text>` : '';
    return `<g class="diagram-edge-group"><path class="diagram-edge${selected}" d="${geometry.path}" data-edge-direction="${direction}"${marker}></path><path class="diagram-edge-hit" d="${geometry.path}" data-edge-id="${escapeHtml(edge.id)}" tabindex="0" role="button" aria-label="Seleccionar conexión"></path>${label}</g>`;
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
    status.textContent = 'Conexión seleccionada. Puedes editar su texto, cambiar la Dirección o eliminarla.';
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
  if (deleteButton) deleteButton.disabled = !selection.id;
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
  root.innerHTML = `<div class="diagram-shell"><header class="diagram-toolbar"><div class="diagram-title-wrap"><span class="diagram-eyebrow">DIAGRAMAS</span><input id="diagram-title" class="diagram-title" value="${escapeHtml(diagram.title)}" maxlength="120" aria-label="Nombre del diagrama" /></div><div class="diagram-toolbar-actions"><label class="diagram-select-wrap"><span>Documento</span><select id="diagram-select" class="diagram-select">${diagrams.map((item) => `<option value="${escapeHtml(item.id)}"${item.id === diagram.id ? ' selected' : ''}>${escapeHtml(item.title)}</option>`).join('')}</select></label><button id="diagram-new" class="btn btn-secondary" type="button">＋ Nuevo</button><button id="diagram-add-node" class="btn btn-primary" type="button">＋ Nodo</button><div class="diagram-history-actions"><button id="diagram-undo" class="btn btn-secondary" type="button" title="Deshacer (⌘/Ctrl+Z)" aria-label="Deshacer (⌘/Ctrl+Z)" disabled>↶ Deshacer</button><button id="diagram-redo" class="btn btn-secondary" type="button" title="Rehacer (⌘/Ctrl+Shift+Z)" aria-label="Rehacer (⌘/Ctrl+Shift+Z)" disabled>↷ Rehacer</button></div><button id="diagram-connect" class="btn btn-secondary${connectMode ? ' is-active' : ''}" type="button">${connectMode ? '✓ Conectar' : '↗ Conectar'}</button><button id="diagram-delete-selection" class="btn btn-danger" type="button" disabled>Eliminar</button></div></header><div class="diagram-main"><div class="diagram-canvas" id="diagram-canvas"><div class="diagram-board" id="diagram-board" style="width: ${BOARD_WIDTH}px; height: ${BOARD_HEIGHT}px;"><svg id="diagram-edge-layer" class="diagram-edge-layer" viewBox="0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}" aria-label="Conexiones del diagrama"><defs><marker id="diagram-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M 0 0 L 8 4 L 0 8 z" fill="currentColor"></path></marker><marker id="diagram-arrow-preview" markerWidth="10" markerHeight="10" refX="8" refY="5" orient="auto" markerUnits="userSpaceOnUse"><path d="M 0 0 L 10 5 L 0 10 z" fill="#4ec9b0"></path></marker></defs><g id="diagram-edge-paths"></g></svg><div id="diagram-node-layer" class="diagram-node-layer"></div><div id="diagram-empty-hint" class="diagram-empty-hint"><strong>Empieza tu flujo</strong><span>Añade un nodo o haz doble clic en el lienzo</span></div></div></div><aside class="diagram-side-panel"><div class="diagram-side-heading"><div><span class="diagram-eyebrow">EDITOR SIMPLE</span><h2>Mapa de flujo</h2></div><span id="diagram-count" class="diagram-count"></span></div><div id="diagram-status" class="diagram-status"></div><div id="diagram-inspector"></div><div class="diagram-help"><strong>Cómo usarlo</strong><p>1. Añade nodos y arrástralos por el lienzo.</p><p>2. Activa “Conectar” y pulsa dos puntos de unión, o arrastra de uno al otro.</p><p>3. Selecciona una línea para escribir una etiqueta o eliminarla.</p><p>4. Usa Deshacer/Rehacer o ⌘/Ctrl+Z, ⌘/Ctrl+Shift+Z.</p></div></aside></div></div>`;
  const arrowMarker = root.querySelector('#diagram-arrow');
  if (arrowMarker) {
    arrowMarker.setAttribute('orient', 'auto-start-reverse');
    arrowMarker.setAttribute('markerUnits', 'userSpaceOnUse');
    arrowMarker.setAttribute('markerWidth', '10');
    arrowMarker.setAttribute('markerHeight', '10');
    arrowMarker.setAttribute('refX', '8');
    arrowMarker.setAttribute('refY', '4');
  }
  root.insertAdjacentHTML('beforeend', '<div id="diagram-context-menu" class="diagram-context-menu" role="menu" aria-label="Dirección de la conexión" aria-hidden="true" hidden><div class="diagram-context-menu-heading">Dirección</div><button type="button" role="menuitemradio" data-edge-direction="none" aria-checked="false">Línea simple</button><button type="button" role="menuitemradio" data-edge-direction="forward" aria-checked="false">→ Hacia el destino</button><button type="button" role="menuitemradio" data-edge-direction="backward" aria-checked="false">← Hacia el origen</button></div>');
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
  const board = $('#diagram-board');
  if (!board) return { x: BOARD_WIDTH / 2, y: BOARD_HEIGHT / 2 };
  const rect = board.getBoundingClientRect();
  return {
    x: clamp((event.clientX - rect.left) * BOARD_WIDTH / rect.width, 0, BOARD_WIDTH),
    y: clamp((event.clientY - rect.top) * BOARD_HEIGHT / rect.height, 0, BOARD_HEIGHT)
  };
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
  if (event.key === 'Escape' && contextMenuEdgeId) {
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
    const point = canvas ? { x: canvas.scrollLeft + canvas.clientWidth / 2, y: canvas.scrollTop + canvas.clientHeight / 2 } : { x: BOARD_WIDTH / 2, y: BOARD_HEIGHT / 2 };
    addNodeAt(point);
  });
  $('#diagram-connect').addEventListener('click', () => {
    connectMode = !connectMode;
    connectionStart = null;
    updateSelectionUI();
  });
  $('#diagram-undo').addEventListener('click', undoDiagramChange);
  $('#diagram-redo').addEventListener('click', redoDiagramChange);
  $('#diagram-delete-selection').addEventListener('click', removeSelection);
  const nodeLayer = $('#diagram-node-layer');
  nodeLayer.addEventListener('pointerdown', handleNodePointerDown);
  nodeLayer.addEventListener('click', handleNodeClick);
  nodeLayer.addEventListener('input', handleNodeInput);
  const edgeLayer = $('#diagram-edge-layer');
  edgeLayer.addEventListener('click', handleEdgeClick);
  edgeLayer.addEventListener('contextmenu', handleEdgeContextMenu);
  $('#diagram-context-menu').addEventListener('click', handleEdgeContextMenuAction);
  const board = $('#diagram-board');
  board.addEventListener('pointerdown', handleBoardPointerDown);
  board.addEventListener('dblclick', handleBoardDoubleClick);
  root.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('#diagram-context-menu')) hideEdgeContextMenu();
  });
  root.addEventListener('pointermove', handlePointerMove);
  root.addEventListener('pointerup', handlePointerUp);
  root.addEventListener('pointercancel', handlePointerCancel);
  root.addEventListener('focusout', (event) => finishTextHistory(event.target));
  root.addEventListener('keydown', handleKeydown);
}
