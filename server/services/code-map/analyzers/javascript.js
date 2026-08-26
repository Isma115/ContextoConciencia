const path = require('node:path');

const DECLARATION_KEYWORDS = new Set(['const', 'let', 'var']);
const NON_CALL_IDENTIFIERS = new Set([
  'if', 'for', 'while', 'switch', 'catch', 'with', 'function', 'class', 'return', 'throw',
  'typeof', 'void', 'delete', 'new', 'await', 'yield', 'import', 'export', 'super'
]);
const MULTI_CHARACTER_OPERATORS = [
  '>>>=', '===', '!==', '**=', '>>>', '...', '=>', '==', '!=', '<=', '>=', '&&', '||',
  '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '**', '<<', '>>', '::', '&=', '|=', '^='
];

function isIdentifierStart(character) { return /[A-Za-z_$]/.test(character); }
function isIdentifierPart(character) { return /[A-Za-z0-9_$]/.test(character); }

function lineAt(lineStarts, offset) {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (lineStarts[middle] <= offset) low = middle + 1;
    else high = middle - 1;
  }
  return high + 1;
}

function lineStartsFor(source) {
  const starts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === '\n') starts.push(index + 1);
  }
  return starts;
}

function decodeString(raw) {
  if (raw.length < 2) return raw;
  return raw.slice(1, -1).replace(/\\([\\'"`])/g, '$1').replace(/\\n/g, '\n').replace(/\\r/g, '\r');
}

function canStartRegex(previous) {
  return !previous || ['(', '[', '{', ',', ';', ':', '=', '=>', 'return', 'throw', 'case', 'delete', 'void', 'typeof', '&&', '||', '?'].includes(previous.value);
}

function tokenize(source) {
  const lineStarts = lineStartsFor(source);
  const tokens = [];
  const warnings = [];
  let index = 0;
  let braceDepth = 0;
  let parenDepth = 0;
  let bracketDepth = 0;

  const add = (value, type, start, end, raw = value) => {
    tokens.push({
      value,
      raw,
      type,
      start,
      end,
      line: lineAt(lineStarts, start),
      endLine: lineAt(lineStarts, Math.max(start, end - 1)),
      braceDepth,
      parenDepth,
      bracketDepth
    });
  };

  while (index < source.length) {
    const character = source[index];
    if (/\s/.test(character)) { index += 1; continue; }
    if (character === '/' && source[index + 1] === '/') {
      index += 2;
      while (index < source.length && source[index] !== '\n') index += 1;
      continue;
    }
    if (character === '/' && source[index + 1] === '*') {
      const end = source.indexOf('*/', index + 2);
      if (end < 0) {
        warnings.push({ line: lineAt(lineStarts, index), message: 'Comentario de bloque sin cerrar' });
        break;
      }
      index = end + 2;
      continue;
    }
    if (character === '"' || character === "'" || character === '`') {
      const quote = character;
      const start = index;
      index += 1;
      let closed = false;
      while (index < source.length) {
        if (source[index] === '\\') { index += 2; continue; }
        if (source[index] === quote) { index += 1; closed = true; break; }
        index += 1;
      }
      const raw = source.slice(start, index);
      add(decodeString(raw), 'string', start, index, raw);
      if (!closed) warnings.push({ line: lineAt(lineStarts, start), message: 'Cadena sin cerrar' });
      continue;
    }
    if (character === '/' && canStartRegex(tokens.at(-1))) {
      const start = index;
      index += 1;
      let inClass = false;
      let closed = false;
      while (index < source.length) {
        if (source[index] === '\\') { index += 2; continue; }
        if (source[index] === '[') inClass = true;
        if (source[index] === ']') inClass = false;
        if (source[index] === '/' && !inClass) { index += 1; while (/[A-Za-z]/.test(source[index] || '')) index += 1; closed = true; break; }
        if (source[index] === '\n') break;
        index += 1;
      }
      if (closed) { add(source.slice(start, index), 'regex', start, index); continue; }
      index = start;
    }
    if (isIdentifierStart(character)) {
      const start = index;
      index += 1;
      while (index < source.length && isIdentifierPart(source[index])) index += 1;
      add(source.slice(start, index), 'identifier', start, index);
      continue;
    }
    if (/[0-9]/.test(character)) {
      const start = index;
      index += 1;
      while (index < source.length && /[A-Za-z0-9._]/.test(source[index])) index += 1;
      add(source.slice(start, index), 'number', start, index);
      continue;
    }
    const operator = MULTI_CHARACTER_OPERATORS.find((candidate) => source.startsWith(candidate, index));
    const value = operator || character;
    const start = index;
    index += value.length;
    add(value, 'punctuation', start, index);
    if (value === '{') braceDepth += 1;
    if (value === '}') {
      if (braceDepth === 0) warnings.push({ line: lineAt(lineStarts, start), message: 'Llave de cierre sin apertura' });
      braceDepth = Math.max(0, braceDepth - 1);
    }
    if (value === '(') parenDepth += 1;
    if (value === ')') {
      if (parenDepth === 0) warnings.push({ line: lineAt(lineStarts, start), message: 'Paréntesis de cierre sin apertura' });
      parenDepth = Math.max(0, parenDepth - 1);
    }
    if (value === '[') bracketDepth += 1;
    if (value === ']') {
      if (bracketDepth === 0) warnings.push({ line: lineAt(lineStarts, start), message: 'Corchete de cierre sin apertura' });
      bracketDepth = Math.max(0, bracketDepth - 1);
    }
  }

  if (braceDepth || parenDepth || bracketDepth) {
    warnings.push({ line: lineAt(lineStarts, source.length), message: 'La estructura de bloques o paréntesis no está equilibrada' });
  }
  return { tokens, warnings, lineStarts };
}

function matchingToken(tokens, startIndex, open = '{', close = '}') {
  let depth = 0;
  for (let index = startIndex; index < tokens.length; index += 1) {
    if (tokens[index].value === open) depth += 1;
    if (tokens[index].value === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return tokens.length - 1;
}

function findNext(tokens, start, value, end = tokens.length) {
  for (let index = start; index < end; index += 1) if (tokens[index].value === value) return index;
  return -1;
}

function identifierAfter(tokens, index) {
  const token = tokens[index + 1];
  return token?.type === 'identifier' ? token : null;
}

function symbolRange(startToken, endToken) {
  return { startLine: startToken?.line || 1, endLine: endToken?.endLine || startToken?.endLine || startToken?.line || 1 };
}

function declarationEnd(tokens, startIndex) {
  let index = startIndex;
  let brace = 0;
  let paren = 0;
  let bracket = 0;
  for (; index < tokens.length; index += 1) {
    const value = tokens[index].value;
    if (value === '{') brace += 1;
    else if (value === '}') brace = Math.max(0, brace - 1);
    else if (value === '(') paren += 1;
    else if (value === ')') paren = Math.max(0, paren - 1);
    else if (value === '[') bracket += 1;
    else if (value === ']') bracket = Math.max(0, bracket - 1);
    if (value === ';' && brace === 0 && paren === 0 && bracket === 0) return index;
    if (index > startIndex && brace === 0 && paren === 0 && bracket === 0 && ['const', 'let', 'var', 'function', 'class', 'export', 'import'].includes(value)) return index - 1;
  }
  return Math.max(startIndex, tokens.length - 1);
}

function addOrGetSymbol(symbols, byName, symbol) {
  const existing = symbols.find((candidate) => candidate.name === symbol.name && candidate.kind === symbol.kind && candidate.range.startLine === symbol.range.startLine);
  if (existing) return existing;
  let name = symbol.name;
  if (byName.has(name)) {
    const count = symbols.filter((candidate) => candidate.name === name).length + 1;
    name = `${name}#${count}`;
  }
  const result = { ...symbol, name, exported: Boolean(symbol.exported) };
  symbols.push(result);
  if (!byName.has(symbol.name)) byName.set(symbol.name, result);
  return result;
}

function parseImport(tokens, index, symbols, byName) {
  const start = tokens[index];
  if (tokens[index + 1]?.value === '(') return null;
  let sourceToken = null;
  const fromIndex = findNext(tokens, index + 1, 'from', Math.min(tokens.length, index + 80));
  if (fromIndex >= 0 && tokens[fromIndex + 1]?.type === 'string') sourceToken = tokens[fromIndex + 1];
  else if (tokens[index + 1]?.type === 'string') sourceToken = tokens[index + 1];
  if (!sourceToken) return null;
  const specifiers = [];
  const end = fromIndex >= 0 ? fromIndex : index + 1;
  let cursor = index + 1;
  if (tokens[cursor]?.type === 'identifier' && tokens[cursor].value !== 'type') {
    specifiers.push({ imported: 'default', local: tokens[cursor].value });
    addOrGetSymbol(symbols, byName, { name: tokens[cursor].value, kind: 'import', range: symbolRange(tokens[cursor], sourceToken), imported: 'default', source: sourceToken.value });
    cursor += 1;
    if (tokens[cursor]?.value === ',') cursor += 1;
  }
  if (tokens[cursor]?.value === '*') {
    const local = tokens[cursor + 2]?.type === 'identifier' ? tokens[cursor + 2].value : '*';
    specifiers.push({ imported: '*', local });
    if (local !== '*') addOrGetSymbol(symbols, byName, { name: local, kind: 'import', range: symbolRange(tokens[cursor], sourceToken), imported: '*', source: sourceToken.value });
  }
  const open = findNext(tokens, cursor, '{', end);
  if (open >= 0) {
    const close = findNext(tokens, open + 1, '}', end);
    for (let position = open + 1; position > 0 && position < (close >= 0 ? close : end); position += 1) {
      const importedToken = tokens[position];
      if (importedToken.type !== 'identifier' && importedToken.type !== 'string') continue;
      if (tokens[position - 1]?.value === ',') { /* inicio de especifier */ }
      if (tokens[position - 1]?.value === 'as') continue;
      const imported = importedToken.value;
      const local = tokens[position + 1]?.value === 'as' && tokens[position + 2]?.type === 'identifier'
        ? tokens[position + 2].value
        : imported;
      specifiers.push({ imported, local });
      addOrGetSymbol(symbols, byName, { name: local, kind: 'import', range: symbolRange(importedToken, sourceToken), imported, source: sourceToken.value });
    }
  }
  return { source: sourceToken.value, specifiers, line: start.line, kind: 'imports' };
}

function parseExportSpecifiers(tokens, index) {
  const open = findNext(tokens, index + 1, '{', Math.min(tokens.length, index + 100));
  if (open < 0) return [];
  const close = findNext(tokens, open + 1, '}', Math.min(tokens.length, open + 100));
  const result = [];
  for (let position = open + 1; position < (close >= 0 ? close : tokens.length); position += 1) {
    const token = tokens[position];
    if (token.type !== 'identifier' && token.type !== 'string') continue;
    if (tokens[position - 1]?.value === 'as' || tokens[position - 1]?.value === ',') {
      if (tokens[position - 1]?.value === 'as') continue;
    }
    const local = token.value;
    const exported = tokens[position + 1]?.value === 'as' && tokens[position + 2]?.type === 'identifier' ? tokens[position + 2].value : local;
    result.push({ local, exported, line: token.line });
  }
  return result;
}

function scanClassMembers(tokens, classTokenIndex, bodyStart, bodyEnd, symbols, byName) {
  const classDepth = (tokens[bodyStart]?.braceDepth ?? 0) + 1;
  for (let index = bodyStart + 1; index < bodyEnd; index += 1) {
    const token = tokens[index];
    if (token.braceDepth !== classDepth) continue;
    let nameToken = token;
    let name = token.value;
    let nameIndex = index;
    if (token.value === 'static' || token.value === 'get' || token.value === 'set' || token.value === 'async') {
      nameToken = tokens[index + 1];
      name = nameToken?.value;
      nameIndex = index + 1;
    }
    if (!nameToken || nameToken.type !== 'identifier' || ['static', 'get', 'set', 'async'].includes(name)) continue;
    if (tokens[nameIndex + 1]?.value === '(') {
      const open = nameIndex + 1;
      const close = matchingToken(tokens, open, '(', ')');
      const body = tokens[close + 1]?.value === '{' ? matchingToken(tokens, close + 1) : close;
      addOrGetSymbol(symbols, byName, { name, kind: name === 'constructor' ? 'constructor' : 'method', range: symbolRange(nameToken, tokens[Math.min(body, bodyEnd - 1)]), owner: tokens[classTokenIndex + 1]?.value || null });
      index = Math.max(index, body);
      continue;
    }
    if (tokens[nameIndex + 1]?.value === '=' || tokens[nameIndex + 1]?.value === ';' || tokens[nameIndex + 1]?.value === ':') {
      addOrGetSymbol(symbols, byName, { name, kind: 'property', range: symbolRange(nameToken, tokens[nameIndex + 1]) });
    }
  }
}

function extractVariableDeclarations(tokens, index, end, symbols, byName) {
  let cursor = index + 1;
  let segmentStart = cursor;
  let brace = 0;
  let paren = 0;
  let bracket = 0;
  const declarations = [];
  for (; cursor <= end && cursor < tokens.length; cursor += 1) {
    const value = tokens[cursor].value;
    if (value === '{') brace += 1;
    if (value === '}') brace = Math.max(0, brace - 1);
    if (value === '(') paren += 1;
    if (value === ')') paren = Math.max(0, paren - 1);
    if (value === '[') bracket += 1;
    if (value === ']') bracket = Math.max(0, bracket - 1);
    if ((value === ',' && brace === 0 && paren === 0 && bracket === 0) || (value === ';' && brace === 0 && paren === 0 && bracket === 0)) {
      declarations.push([segmentStart, cursor - 1]);
      segmentStart = cursor + 1;
    }
  }
  if (segmentStart <= end) declarations.push([segmentStart, end]);
  for (const [start, finish] of declarations) {
    const equals = findNext(tokens, start, '=', finish + 1);
    const nameToken = tokens[start];
    if (!nameToken) continue;
    if (nameToken.value === '{' || nameToken.value === '[') {
      const names = [];
      for (let position = start + 1; position < (equals >= 0 ? equals : finish + 1); position += 1) {
        const candidate = tokens[position];
        if (candidate.type !== 'identifier' || ['const', 'let', 'var'].includes(candidate.value)) continue;
        if (tokens[position + 1]?.value === ':') continue;
        if (tokens[position - 1]?.value === ':' || [',', '}', ']', '='].includes(tokens[position + 1]?.value) || tokens[position - 1]?.value === '{' || tokens[position - 1]?.value === '[') names.push(candidate);
      }
      const endToken = tokens[Math.max(start, finish)] || nameToken;
      names.forEach((candidate) => addOrGetSymbol(symbols, byName, { name: candidate.value, kind: 'variable', range: symbolRange(nameToken, endToken) }));
      continue;
    }
    if (nameToken.type !== 'identifier') continue;
    const initial = equals >= 0 ? tokens[equals + 1] : null;
    const hasArrow = equals >= 0 && tokens.slice(equals + 1, finish + 1).some((token) => token.value === '=>');
    const kind = initial?.value === 'function' || hasArrow ? 'function' : initial?.value === 'class' ? 'class' : 'variable';
    const endToken = tokens[Math.max(start, finish)] || nameToken;
    addOrGetSymbol(symbols, byName, { name: nameToken.value, kind, range: symbolRange(nameToken, endToken) });
  }
}

function findFunctionBody(tokens, index) {
  const open = findNext(tokens, index + 1, '{', Math.min(tokens.length, index + 200));
  return open >= 0 ? matchingToken(tokens, open) : index;
}

function analyseJavaScript(source, { filePath = '', language = 'javascript' } = {}) {
  const { tokens, warnings, lineStarts } = tokenize(String(source || ''));
  const symbols = [];
  const byName = new Map();
  const imports = [];
  const exports = [];
  const calls = [];
  const extendsRelations = [];
  const dynamicImports = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const topLevel = token.braceDepth === 0 && token.parenDepth === 0 && token.bracketDepth === 0;
    if (token.value === 'import') {
      if (tokens[index + 1]?.value === '(' && tokens[index + 2]?.type === 'string') {
        dynamicImports.push({ source: tokens[index + 2].value, line: token.line, kind: 'imports' });
      } else if (tokens[index + 1]?.value === '(') {
        dynamicImports.push({ source: null, request: 'import()', unresolved: true, line: token.line, kind: 'imports' });
      } else if (topLevel) {
        const parsed = parseImport(tokens, index, symbols, byName);
        if (parsed) imports.push(parsed);
      }
    }
    if (token.value === 'require' && tokens[index + 1]?.value === '(') {
      if (tokens[index + 2]?.type !== 'string') {
        imports.push({ source: null, request: 'require()', unresolved: true, specifiers: [], line: token.line, kind: 'requires' });
      } else {
        const localToken = tokens[index - 1]?.value === '=' && tokens[index - 2]?.type === 'identifier' ? tokens[index - 2] : null;
        const specifiers = localToken ? [{ imported: 'default', local: localToken.value }] : [];
        if (!localToken && tokens[index - 1]?.value === '=') {
          const declarationStart = Math.max(0, index - 30);
          const names = [];
          for (let position = declarationStart; position < index - 1; position += 1) {
            const candidate = tokens[position];
            if (candidate.type !== 'identifier' || ['const', 'let', 'var'].includes(candidate.value)) continue;
            if (tokens[position + 1]?.value === ':') continue;
            if (tokens[position - 1]?.value === ':' || [',', '}', ']', '='].includes(tokens[position + 1]?.value)) names.push(candidate.value);
          }
          names.forEach((name) => specifiers.push({ imported: name, local: name }));
        }
        imports.push({ source: tokens[index + 2].value, specifiers, line: token.line, kind: 'requires' });
      }
    }
    if (topLevel && token.value === 'function') {
      const nameToken = identifierAfter(tokens, index) || { value: 'default', type: 'identifier', line: token.line, endLine: token.line };
      const endIndex = findFunctionBody(tokens, index);
      addOrGetSymbol(symbols, byName, { name: nameToken.value, kind: 'function', range: symbolRange(token, tokens[endIndex]) });
      index = Math.min(index, endIndex);
    }
    if (topLevel && token.value === 'class') {
      const nameToken = identifierAfter(tokens, index) || { value: 'default', type: 'identifier', line: token.line, endLine: token.line };
      const bodyStart = findNext(tokens, index + 1, '{', Math.min(tokens.length, index + 200));
      const extendsIndex = findNext(tokens, index + 1, 'extends', bodyStart >= 0 ? bodyStart : Math.min(tokens.length, index + 80));
      const extendsToken = extendsIndex >= 0 ? tokens[extendsIndex + 1] : null;
      const endIndex = bodyStart >= 0 ? matchingToken(tokens, bodyStart) : index;
      const classSymbol = addOrGetSymbol(symbols, byName, { name: nameToken.value, kind: 'class', range: symbolRange(token, tokens[endIndex]), extendsName: extendsToken?.type === 'identifier' ? extendsToken.value : null });
      if (classSymbol.extendsName) extendsRelations.push({ fromName: classSymbol.name, targetName: classSymbol.extendsName, line: extendsToken.line });
      if (bodyStart >= 0) scanClassMembers(tokens, index, bodyStart, endIndex, symbols, byName);
    }
    if (topLevel && ['interface', 'type', 'enum', 'namespace'].includes(token.value)) {
      const nameToken = identifierAfter(tokens, index);
      if (nameToken) {
        const bodyStart = findNext(tokens, index + 1, '{', Math.min(tokens.length, index + 200));
        const endIndex = bodyStart >= 0 ? matchingToken(tokens, bodyStart) : declarationEnd(tokens, index + 1);
        addOrGetSymbol(symbols, byName, { name: nameToken.value, kind: token.value, range: symbolRange(token, tokens[endIndex]) });
      }
    }
    if (topLevel && DECLARATION_KEYWORDS.has(token.value)) {
      if (!['identifier', '{', '['].includes(tokens[index + 1]?.type) && !['{', '['].includes(tokens[index + 1]?.value)) {
        warnings.push({ line: token.line, message: `Declaración ${token.value} sin nombre válido` });
      }
      const end = declarationEnd(tokens, index + 1);
      extractVariableDeclarations(tokens, index, end, symbols, byName);
    }
    if (topLevel && token.value === 'export') {
      const next = tokens[index + 1];
      if (next?.value === 'default') {
        const declaration = tokens[index + 2];
        if (declaration?.value === 'function' || declaration?.value === 'class') {
          const local = tokens[index + 3]?.type === 'identifier' ? tokens[index + 3].value : 'default';
          const symbol = byName.get(local) || addOrGetSymbol(symbols, byName, { name: local, kind: declaration.value, range: symbolRange(declaration, declaration) });
          symbol.exported = true;
          exports.push({ local: symbol.name, exported: 'default', line: next.line });
        } else {
          const local = declaration?.type === 'identifier' ? declaration.value : 'default';
          const symbol = byName.get(local) || addOrGetSymbol(symbols, byName, { name: local, kind: 'export', range: symbolRange(next, declaration || next) });
          symbol.exported = true;
          exports.push({ local: symbol.name, exported: 'default', line: next.line });
        }
      } else if (next?.value === '*' || next?.value === '{') {
        const sourceIndex = findNext(tokens, index + 1, 'from', Math.min(tokens.length, index + 100));
        const source = sourceIndex >= 0 && tokens[sourceIndex + 1]?.type === 'string' ? tokens[sourceIndex + 1].value : null;
        if (next.value === '*') exports.push({ local: '*', exported: '*', source, line: token.line });
        else parseExportSpecifiers(tokens, index).forEach((item) => exports.push({ ...item, source }));
      } else if (next?.value === 'function' || next?.value === 'class' || ['interface', 'type', 'enum', 'namespace'].includes(next?.value) || DECLARATION_KEYWORDS.has(next?.value)) {
        const local = tokens[index + 3]?.type === 'identifier' ? tokens[index + 3].value : tokens[index + 2]?.type === 'identifier' ? tokens[index + 2].value : null;
        if (local) {
          const symbol = byName.get(local);
          if (symbol) symbol.exported = true;
          exports.push({ local, exported: local, line: token.line });
        }
      }
    }
    if (topLevel && token.value === 'module' && tokens[index + 1]?.value === '.' && tokens[index + 2]?.value === 'exports') {
      const property = tokens[index + 3]?.value === '.' && tokens[index + 4]?.type === 'identifier' ? tokens[index + 4] : null;
      const exportedName = property?.value || 'default';
      let localToken = property ? tokens[index + 6] : tokens[index + 4];
      if (localToken?.value === 'function' || localToken?.value === 'class') localToken = tokens[(property ? index + 7 : index + 5)];
      const local = localToken?.type === 'identifier' && localToken.value !== '=' ? localToken.value : exportedName;
      const symbol = byName.get(local) || addOrGetSymbol(symbols, byName, { name: local, kind: 'export', range: symbolRange(token, localToken || token) });
      symbol.exported = true;
      exports.push({ local: symbol.name, exported: exportedName, line: token.line });
    }
    if (topLevel && token.value === 'exports' && tokens[index + 1]?.value === '.' && tokens[index + 2]?.type === 'identifier') {
      const exportedName = tokens[index + 2].value;
      let localToken = tokens[index + 4]?.type === 'identifier' ? tokens[index + 4] : tokens[index + 2];
      if (localToken?.value === 'function' || localToken?.value === 'class') localToken = tokens[index + 5] || localToken;
      const symbol = byName.get(localToken.value) || addOrGetSymbol(symbols, byName, { name: localToken.value, kind: 'export', range: symbolRange(token, localToken) });
      symbol.exported = true;
      exports.push({ local: symbol.name, exported: exportedName, line: token.line });
    }
  }

  const declarationNames = new Set(symbols.map((symbol) => symbol.name));
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];
    if (token.type !== 'identifier' || next.value !== '(' || NON_CALL_IDENTIFIERS.has(token.value)) continue;
    if (tokens[index - 1]?.value === 'function' || tokens[index - 1]?.value === 'class') continue;
    if (token.value === 'require' || token.value === 'import') continue;
    const callClose = matchingToken(tokens, index + 1, '(', ')');
    if (tokens[callClose + 1]?.value === '{') continue;
    const owner = symbols.filter((symbol) => symbol.range.startLine <= token.line && symbol.range.endLine >= token.line && ['function', 'class', 'method'].includes(symbol.kind)).sort((first, second) => (first.range.endLine - first.range.startLine) - (second.range.endLine - second.range.startLine))[0];
    calls.push({ targetName: token.value, fromName: owner?.name || null, line: token.line, local: declarationNames.has(token.value) });
  }

  const uniqueImports = new Map();
  [...imports, ...dynamicImports].forEach((item) => {
    const key = `${item.kind}:${item.source}:${item.line}`;
    if (!uniqueImports.has(key)) uniqueImports.set(key, item);
  });
  const uniqueExports = new Map();
  exports.forEach((item) => {
    const key = `${item.local}:${item.exported}:${item.source || ''}:${item.line}`;
    if (!uniqueExports.has(key)) uniqueExports.set(key, item);
  });
  const uniqueCalls = new Map();
  calls.forEach((item) => {
    const key = `${item.fromName || ''}:${item.targetName}:${item.line}`;
    if (!uniqueCalls.has(key)) uniqueCalls.set(key, item);
  });

  return {
    language,
    extension: path.extname(filePath).toLowerCase().slice(1),
    symbols: symbols.sort((first, second) => first.range.startLine - second.range.startLine || first.name.localeCompare(second.name)),
    imports: [...uniqueImports.values()],
    exports: [...uniqueExports.values()],
    calls: [...uniqueCalls.values()],
    extendsRelations,
    warnings,
    lineCount: lineStarts.length
  };
}

module.exports = { analyseJavaScript, analyzeJavaScript: analyseJavaScript, tokenize, lineStartsFor };
