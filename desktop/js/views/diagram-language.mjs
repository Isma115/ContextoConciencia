const BOARD_WIDTH = 1400;
const BOARD_HEIGHT = 900;
const NODE_WIDTH = 190;
const NODE_HEIGHT = 88;
const NODE_MARGIN = 20;
const AUTO_LAYOUT_COLUMNS = 4;
const AUTO_LAYOUT_COLUMN_GAP = 140;
const AUTO_LAYOUT_ROW_GAP = 120;
const NODE_ID_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;

const TYPE_ALIASES = Object.freeze({
  start: 'start',
  inicio: 'start',
  step: 'step',
  paso: 'step',
  decision: 'decision',
  fin: 'end',
  end: 'end'
});

const DIRECTION_ALIASES = Object.freeze({
  none: 'none',
  simple: 'none',
  forward: 'forward',
  directo: 'forward',
  backward: 'backward',
  reverse: 'backward',
  reversa: 'backward'
});

export class DiagramSyntaxError extends Error {
  constructor(message, line = 1, column = 1) {
    super(`${message} (línea ${line}${column > 1 ? `, columna ${column}` : ''})`);
    this.name = 'DiagramSyntaxError';
    this.line = line;
    this.column = column;
  }
}

function normaliseKey(value) {
  return String(value || '')
    .trim()
    .toLocaleLowerCase('es-ES')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function defaultPosition(index) {
  return {
    x: 100 + (index % AUTO_LAYOUT_COLUMNS) * (NODE_WIDTH + AUTO_LAYOUT_COLUMN_GAP),
    y: 100 + Math.floor(index / AUTO_LAYOUT_COLUMNS) * (NODE_HEIGHT + AUTO_LAYOUT_ROW_GAP)
  };
}

function fail(message, line, column = 1) {
  throw new DiagramSyntaxError(message, line, column);
}

function tokeniseLine(line, lineNumber) {
  const tokens = [];
  let index = 0;
  while (index < line.length) {
    while (/\s/.test(line[index] || '')) index += 1;
    if (index >= line.length) break;

    const start = index;
    if (line.startsWith('->', index)) {
      tokens.push({ value: '->', quoted: false, column: index + 1 });
      index += 2;
      continue;
    }
    if (line[index] === ':') {
      tokens.push({ value: ':', quoted: false, column: index + 1 });
      index += 1;
      continue;
    }
    if (line[index] === '"') {
      index += 1;
      let escaped = false;
      let closed = false;
      while (index < line.length) {
        const character = line[index];
        if (escaped) {
          escaped = false;
          index += 1;
          continue;
        }
        if (character === '\\') {
          escaped = true;
          index += 1;
          continue;
        }
        if (character === '"') {
          index += 1;
          closed = true;
          break;
        }
        index += 1;
      }
      if (!closed || escaped) fail('Cadena entre comillas sin cerrar', lineNumber, start + 1);
      const raw = line.slice(start, index);
      let value;
      try {
        value = JSON.parse(raw);
      } catch {
        fail('Cadena entre comillas no válida', lineNumber, start + 1);
      }
      tokens.push({ value, quoted: true, column: start + 1 });
      continue;
    }
    while (index < line.length && !/\s/.test(line[index])) {
      if (line.startsWith('->', index) || line[index] === ':') break;
      index += 1;
    }
    if (index === start) {
      fail(`Símbolo inesperado “${line[index]}”`, lineNumber, index + 1);
    }
    tokens.push({ value: line.slice(start, index), quoted: false, column: start + 1 });
  }
  return tokens;
}

function parseCoordinates(tokens, index, lineNumber) {
  const coordinateText = tokens.slice(index + 1).map((token) => token.value).join(' ');
  const match = /^(-?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*(-?(?:\d+(?:\.\d+)?|\.\d+))$/.exec(coordinateText);
  if (!match) fail('La posición debe tener el formato “at x, y”', lineNumber, tokens[index].column);
  const x = Number(match[1]);
  const y = Number(match[2]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) fail('La posición no es numérica', lineNumber, tokens[index].column);
  return { x, y };
}

function parseNode(tokens, lineNumber, index) {
  if (tokens.length < 3) fail('Un nodo necesita un identificador y una etiqueta entre comillas', lineNumber);
  const idToken = tokens[1];
  const labelToken = tokens[2];
  if (idToken.quoted || !NODE_ID_PATTERN.test(idToken.value)) {
    fail(`Identificador de nodo no válido: “${idToken.value}”`, lineNumber, idToken.column);
  }
  if (!labelToken.quoted) fail('La etiqueta del nodo debe ir entre comillas', lineNumber, labelToken.column);

  let type = 'step';
  let position = defaultPosition(index);
  let typeSeen = false;
  for (let cursor = 3; cursor < tokens.length; cursor += 1) {
    const token = tokens[cursor];
    const key = normaliseKey(token.value);
    if (key === 'at') {
      if (cursor !== tokens.length - 1 && cursor + 1 < tokens.length) position = parseCoordinates(tokens, cursor, lineNumber);
      else fail('Falta la posición después de “at”', lineNumber, token.column);
      cursor = tokens.length;
      continue;
    }
    const nextType = TYPE_ALIASES[key];
    if (!nextType) fail(`Opción de nodo desconocida: “${token.value}”`, lineNumber, token.column);
    if (typeSeen) fail('El tipo del nodo solo puede aparecer una vez', lineNumber, token.column);
    type = nextType;
    typeSeen = true;
  }

  return {
    id: idToken.value,
    label: String(labelToken.value).slice(0, 160),
    type,
    x: clamp(position.x, NODE_MARGIN, BOARD_WIDTH - NODE_WIDTH - NODE_MARGIN),
    y: clamp(position.y, NODE_MARGIN, BOARD_HEIGHT - NODE_HEIGHT - NODE_MARGIN)
  };
}

function parseEdge(tokens, lineNumber, index) {
  if (tokens.length < 4) fail('Una conexión necesita origen, “->” y destino', lineNumber);
  const sourceToken = tokens[1];
  const arrowToken = tokens[2];
  const targetToken = tokens[3];
  if (sourceToken.quoted || !NODE_ID_PATTERN.test(sourceToken.value)) fail(`Origen de conexión no válido: “${sourceToken.value}”`, lineNumber, sourceToken.column);
  if (arrowToken.value !== '->') fail('Las conexiones deben usar “->”', lineNumber, arrowToken.column);
  if (targetToken.quoted || !NODE_ID_PATTERN.test(targetToken.value)) fail(`Destino de conexión no válido: “${targetToken.value}”`, lineNumber, targetToken.column);

  let cursor = 4;
  let label = '';
  let direction = 'forward';
  if (tokens[cursor]?.value === ':') cursor += 1;
  if (tokens[cursor]?.quoted) {
    label = String(tokens[cursor].value).slice(0, 120);
    cursor += 1;
  } else if (tokens[cursor] && !DIRECTION_ALIASES[normaliseKey(tokens[cursor].value)]) {
    fail('La etiqueta de la conexión debe ir entre comillas', lineNumber, tokens[cursor].column);
  }
  if (tokens[cursor]) {
    const nextDirection = DIRECTION_ALIASES[normaliseKey(tokens[cursor].value)];
    if (!nextDirection) fail(`Dirección de conexión desconocida: “${tokens[cursor].value}”`, lineNumber, tokens[cursor].column);
    direction = nextDirection;
    cursor += 1;
  }
  if (tokens[cursor]) fail(`Contenido inesperado después de la conexión: “${tokens[cursor].value}”`, lineNumber, tokens[cursor].column);

  return {
    id: `edge-${index + 1}`,
    source: { nodeId: sourceToken.value, port: 'right' },
    target: { nodeId: targetToken.value, port: 'left' },
    label,
    direction
  };
}

function diagramId(title) {
  const slug = normaliseKey(title).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `diagram-${slug || 'texto'}`;
}

export function parseDiagramText(source) {
  const text = String(source ?? '').replace(/\r\n?/g, '\n');
  const nodes = [];
  const edges = [];
  const nodeIds = new Set();
  let title = 'Diagrama generado';
  let hasTitle = false;

  text.split('\n').forEach((rawLine, lineIndex) => {
    const lineNumber = lineIndex + 1;
    const content = rawLine.trim();
    if (!content || content.startsWith('#') || content.startsWith('//')) return;
    const tokens = tokeniseLine(content, lineNumber);
    const command = normaliseKey(tokens[0]?.value);
    if (command === 'diagram') {
      if (hasTitle) fail('Solo puede existir una declaración “diagram”', lineNumber, tokens[0].column);
      if (tokens.length > 2 || (tokens[1] && !tokens[1].quoted)) fail('La declaración “diagram” necesita un título entre comillas', lineNumber, tokens[0].column);
      title = String(tokens[1]?.value || title).slice(0, 120);
      hasTitle = true;
      return;
    }
    if (command === 'node') {
      const node = parseNode(tokens, lineNumber, nodes.length);
      if (nodeIds.has(node.id)) fail(`El nodo “${node.id}” está repetido`, lineNumber, tokens[1].column);
      nodeIds.add(node.id);
      nodes.push(node);
      return;
    }
    if (command === 'edge' || command === 'connect') {
      edges.push({ ...parseEdge(tokens, lineNumber, edges.length), lineNumber });
      return;
    }
    fail(`Instrucción desconocida: “${tokens[0]?.value || ''}”`, lineNumber, tokens[0]?.column || 1);
  });

  const resolvedEdges = edges.map(({ lineNumber, ...edge }) => {
    if (!nodeIds.has(edge.source.nodeId)) fail(`El nodo de origen “${edge.source.nodeId}” no existe`, lineNumber);
    if (!nodeIds.has(edge.target.nodeId)) fail(`El nodo de destino “${edge.target.nodeId}” no existe`, lineNumber);
    return edge;
  });
  return {
    id: diagramId(title),
    title,
    nodes,
    edges: resolvedEdges
  };
}

function numberText(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(fallback);
  return String(Math.round(number * 100) / 100);
}

function quote(value) {
  return JSON.stringify(String(value ?? ''));
}

export function serializeDiagram(diagram) {
  const lines = [`diagram ${quote(diagram?.title || 'Diagrama sin título')}`];
  const nodes = Array.isArray(diagram?.nodes) ? diagram.nodes : [];
  const edges = Array.isArray(diagram?.edges) ? diagram.edges : [];
  if (nodes.length) lines.push('');
  nodes.forEach((node) => {
    const type = TYPE_ALIASES[normaliseKey(node?.type)] || 'step';
    lines.push(`node ${node.id} ${quote(node.label || 'Paso')} ${type} at ${numberText(node.x, 100)}, ${numberText(node.y, 100)}`);
  });
  if (edges.length) lines.push('');
  edges.forEach((edge) => {
    const label = edge?.label ? ` ${quote(edge.label)}` : '';
    const direction = DIRECTION_ALIASES[normaliseKey(edge?.direction)] || 'forward';
    lines.push(`edge ${edge?.source?.nodeId || ''} -> ${edge?.target?.nodeId || ''}${label} ${direction}`);
  });
  return `${lines.join('\n')}\n`;
}
