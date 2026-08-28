import { escapeHtml } from '../core/dom.js';
import { copyPathButtonMarkup } from './documents.js';

const RELATION_LABELS = {
  imports: 'importa',
  requires: 'requiere',
  calls: 'llama',
  extends: 'hereda',
  exports: 'exporta',
  'references-script': 'script',
  'references-style': 'estilo',
  'imports-style': 'css import'
};

const LANGUAGE_LABELS = {
  javascript: 'JS', typescript: 'TS', html: 'HTML', css: 'CSS', python: 'PY', java: 'JAVA', csharp: 'C#',
  c: 'C', cpp: 'C++', go: 'GO', rust: 'RS', php: 'PHP', ruby: 'RB', kotlin: 'KT', swift: 'SWIFT',
  dart: 'DART', lua: 'LUA', r: 'R', scala: 'SCALA', perl: 'PL', shell: 'SH', powershell: 'PS', sql: 'SQL'
};

export function relationLabel(kind) { return RELATION_LABELS[kind] || kind; }
export function languageLabel(language) { return LANGUAGE_LABELS[language] || language; }

function folderOf(filePath) {
  const pieces = String(filePath || '').split('/');
  return pieces.length > 1 ? pieces.slice(0, -1).join('/') : 'raíz';
}

function fileMatches(file, filters) {
  if (filters.language && file.language !== filters.language) return false;
  if (filters.symbolKind && !file.symbols.some((symbol) => symbol.kind === filters.symbolKind)) return false;
  const query = String(filters.query || '').trim().toLocaleLowerCase();
  if (!query) return true;
  return file.path.toLocaleLowerCase().includes(query) || file.symbols.some((symbol) => symbol.name.toLocaleLowerCase().includes(query));
}

export function visibleCodeMap(result, filters = {}) {
  const files = (result?.files || []).filter((file) => fileMatches(file, filters));
  const fileIds = new Set(files.map((file) => file.id));
  const symbolParent = new Map(files.flatMap((file) => file.symbols.map((symbol) => [symbol.id, file.id])));
  const relationKind = filters.relationKind || '';
  const relations = (result?.relations || []).filter((relation) => {
    if (relationKind && relation.kind !== relationKind) return false;
    const from = relation.from?.startsWith('symbol:') ? symbolParent.get(relation.from) : relation.from;
    const to = relation.to?.startsWith('symbol:') ? symbolParent.get(relation.to) : relation.to;
    return fileIds.has(from) && (!to || fileIds.has(to) || relation.to?.startsWith('package:'));
  });
  return { files, relations, fileIds, symbolParent };
}

export function layoutCodeMap(result, filters = {}, expanded = {}, groupByFolder = true) {
  const visible = visibleCodeMap(result, filters);
  const groups = new Map();
  visible.files.forEach((file) => {
    const group = groupByFolder ? folderOf(file.path) : 'proyecto';
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(file);
  });
  const externalPackages = (result?.externalPackages || []).filter((packageEntry) => visible.relations.some((relation) => relation.to === packageEntry.id));
  if (externalPackages.length) groups.set('paquetes externos', externalPackages);
  const columns = [...groups.entries()].sort(([first], [second]) => first === 'paquetes externos' ? 1 : second === 'paquetes externos' ? -1 : first.localeCompare(second));
  const positions = new Map();
  const nodeWidth = 286;
  const columnGap = 58;
  const rowGap = 22;
  const nodeHeights = new Map();
  let boardHeight = 430;
  columns.forEach(([group, files], columnIndex) => {
    let y = 54;
    files.sort((first, second) => (first.path || first.name).localeCompare(second.path || second.name));
    files.forEach((file) => {
      const isPackage = file.kind === 'package';
      const isExpanded = !isPackage && expanded[file.id] === true;
      const height = isPackage ? 84 : isExpanded ? 114 + Math.min(file.symbols.length, 60) * 25 : 114;
      nodeHeights.set(file.id, height);
      positions.set(file.id, { x: 24 + columnIndex * (nodeWidth + columnGap), y, width: nodeWidth, height });
      y += height + rowGap;
    });
    boardHeight = Math.max(boardHeight, y + 40);
  });
  return {
    ...visible,
    groups: columns,
    positions,
    nodeHeights,
    externalPackages,
    width: Math.max(960, columns.length * (nodeWidth + columnGap) + 24),
    height: boardHeight
  };
}

function edgePoint(position, side = 'bottom') {
  return {
    x: position.x + position.width / 2,
    y: side === 'top' ? position.y : position.y + position.height
  };
}

function edgeMarkup(relation, layout, selectedRelationId) {
  const parentFrom = relation.from?.startsWith('symbol:') ? layout.symbolParent.get(relation.from) : relation.from;
  const parentTo = relation.to?.startsWith('symbol:') ? layout.symbolParent.get(relation.to) : relation.to;
  if (!parentFrom || !parentTo || parentFrom === parentTo) return '';
  const from = layout.positions.get(parentFrom);
  const to = layout.positions.get(parentTo);
  if (!from || !to) return '';
  const start = edgePoint(from, to.y >= from.y ? 'bottom' : 'top');
  const end = edgePoint(to, to.y >= from.y ? 'top' : 'bottom');
  const bend = Math.max(42, Math.abs(end.y - start.y) * .35);
  const controlOneY = start.y + (to.y >= from.y ? bend : -bend);
  const controlTwoY = end.y - (to.y >= from.y ? bend : -bend);
  const selected = relation.id === selectedRelationId ? ' is-selected' : '';
  return `<path class="code-map-edge code-map-edge-${escapeHtml(relation.kind)}${selected}" d="M ${start.x} ${start.y} C ${start.x} ${controlOneY}, ${end.x} ${controlTwoY}, ${end.x} ${end.y}" data-code-map-relation="${escapeHtml(relation.id)}" tabindex="0" role="button" aria-label="${escapeHtml(`${relationLabel(relation.kind)} ${relation.request || ''}`)}"><title>${escapeHtml(`${relationLabel(relation.kind)}${relation.request ? ` · ${relation.request}` : ''}`)}</title></path>`;
}

function symbolMarkup(symbol, selectedId) {
  const selected = symbol.id === selectedId ? ' is-selected' : '';
  const exported = symbol.exported ? '<span class="code-map-symbol-export">↗</span>' : '';
  return `<button type="button" class="code-map-symbol${selected}" data-code-map-symbol="${escapeHtml(symbol.id)}" title="${escapeHtml(`${symbol.kind} · línea ${symbol.range?.startLine || 1}`)}"><span class="code-map-symbol-kind">${escapeHtml(symbol.kind)}</span><span class="code-map-symbol-name">${escapeHtml(symbol.name)}</span>${exported}<span class="code-map-symbol-line">${escapeHtml(symbol.range?.startLine || 1)}</span></button>`;
}

function nodeMarkup(file, position, expanded, selectedId, selectedSymbolId, depth) {
  const selected = selectedId === file.id ? ' is-selected' : '';
  const symbols = expanded
    ? `<div class="code-map-symbols">${file.symbols.length ? file.symbols.slice(0, 60).map((symbol) => symbolMarkup(symbol, selectedSymbolId)).join('') : '<span class="code-map-no-symbols">Sin símbolos extraídos</span>'}${file.symbols.length > 60 ? `<span class="code-map-no-symbols">+${file.symbols.length - 60} símbolos ocultos</span>` : ''}</div>`
    : '';
  const warning = file.warnings?.length ? `<span class="code-map-node-warning" title="${escapeHtml(file.warnings[0].message)}">!</span>` : '';
  const toggleLabel = expanded ? 'Replegar símbolos' : 'Desplegar símbolos';
  return `<article class="code-map-node${selected}" data-code-map-file="${escapeHtml(file.id)}" style="left:${position.x}px;top:${position.y}px;width:${position.width}px;min-height:${position.height}px" tabindex="0" role="button" aria-label="${escapeHtml(file.path)}"><div class="code-map-node-head"><button type="button" class="code-map-node-toggle" data-code-map-toggle="${escapeHtml(file.id)}" aria-label="${escapeHtml(toggleLabel)}">${expanded ? '⌄' : '›'}</button><button type="button" class="code-map-node-title" data-code-map-file-select="${escapeHtml(file.id)}"><span class="code-map-file-icon">${escapeHtml(languageLabel(file.language))}</span><span class="code-map-file-path" title="${escapeHtml(file.path)}">${escapeHtml(file.path)}</span></button>${copyPathButtonMarkup(file.path, { className: 'code-map-node-copy-path' })}${warning}</div><div class="code-map-node-meta"><span>${file.symbols.length} símbolo${file.symbols.length === 1 ? '' : 's'}</span><span>${file.warnings?.length || 0} aviso${file.warnings?.length === 1 ? '' : 's'}</span><span>${escapeHtml(file.size > 1024 ? `${Math.round(file.size / 1024)} KB` : `${file.size} B`)}</span></div>${depth === 'symbols' && !expanded ? `<div class="code-map-node-hint">Despliega para ver símbolos</div>` : ''}${symbols}</article>`;
}

function packageMarkup(packageEntry, position, selectedRelationId) {
  const selected = (selectedRelationId && (selectedRelationId === packageEntry.id)) ? ' is-selected' : '';
  return `<article class="code-map-node code-map-package-node${selected}" style="left:${position.x}px;top:${position.y}px;width:${position.width}px;min-height:${position.height}px" data-code-map-package="${escapeHtml(packageEntry.id)}"><div class="code-map-node-head"><span class="code-map-file-icon">PKG</span><span class="code-map-file-path" title="${escapeHtml(packageEntry.name)}">${escapeHtml(packageEntry.name)}</span></div><div class="code-map-node-meta"><span>Dependencia externa</span></div><div class="code-map-node-hint">No se inspecciona su código</div></article>`;
}

export function renderCodeMapGraph(container, { result, filters = {}, expanded = {}, groupByFolder = true, selectedId = null, selectedSymbolId = null, selectedRelationId = null, depth = 'files', zoom = 1 } = {}) {
  if (!container) return { layout: null };
  if (!result?.files?.length) {
    container.innerHTML = '<div class="code-map-graph-empty">No hay elementos que coincidan con los filtros actuales.</div>';
    return { layout: null };
  }
  const effectiveExpanded = { ...expanded };
  if (depth === 'symbols') result.files.forEach((file) => { effectiveExpanded[file.id] = true; });
  const layout = layoutCodeMap(result, filters, effectiveExpanded, groupByFolder);
  const edges = layout.relations.map((relation) => edgeMarkup(relation, layout, selectedRelationId)).join('');
  const nodes = layout.files.map((file) => nodeMarkup(file, layout.positions.get(file.id), effectiveExpanded[file.id] === true, selectedId, selectedSymbolId, depth)).join('') + layout.externalPackages.map((packageEntry) => packageMarkup(packageEntry, layout.positions.get(packageEntry.id), selectedRelationId)).join('');
  const groups = layout.groups.map(([name, files]) => {
    const first = layout.positions.get(files[0].id);
    return first ? `<div class="code-map-group-label" style="left:${first.x}px;top:16px">${escapeHtml(name)}<span>${files.length}</span></div>` : '';
  }).join('');
  const marker = '<defs><marker id="code-map-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 z" fill="currentColor"></path></marker></defs>';
  container.innerHTML = `<div class="code-map-board" style="width:${layout.width}px;height:${layout.height}px;transform:scale(${Math.max(.35, Math.min(2, zoom))})"><svg class="code-map-edge-layer" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" aria-hidden="false">${marker}${edges}</svg><div class="code-map-group-layer">${groups}</div><div class="code-map-node-layer">${nodes}</div></div>`;
  return { layout };
}

export function minimapMarkup(result, filters = {}, expanded = {}, groupByFolder = true) {
  const layout = layoutCodeMap(result, filters, expanded, groupByFolder);
  if (!layout.files.length) return '';
  return `<div class="code-map-minimap" aria-label="Minimapa del mapa de código"><span class="code-map-minimap-title">MINIMAPA</span><div class="code-map-minimap-body">${layout.files.slice(0, 120).map((file) => `<span class="code-map-minimap-dot code-map-minimap-${escapeHtml(file.language)}" title="${escapeHtml(file.path)}"></span>`).join('')}</div></div>`;
}

export const CODE_MAP_RELATION_KINDS = Object.keys(RELATION_LABELS);
export const CODE_MAP_SYMBOL_KINDS = ['variable', 'function', 'class', 'constructor', 'method', 'property', 'import', 'export', 'interface', 'type', 'enum', 'struct', 'trait', 'protocol', 'record', 'object', 'namespace', 'module', 'extension', 'element'];
