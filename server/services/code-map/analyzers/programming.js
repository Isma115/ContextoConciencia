const path = require('node:path');

const CONTROL_CALLS = new Set([
  'if', 'else', 'for', 'foreach', 'while', 'switch', 'catch', 'when', 'with', 'do', 'try',
  'return', 'throw', 'sizeof', 'typeof', 'nameof', 'new', 'in', 'is', 'as', 'assert',
  'function', 'def', 'func', 'fn', 'class', 'struct', 'interface', 'enum', 'select'
]);

const HASH_COMMENT_LANGUAGES = new Set(['python', 'ruby', 'r', 'perl', 'shell', 'powershell']);
const DASH_COMMENT_LANGUAGES = new Set(['lua', 'sql']);
const C_STYLE_LANGUAGES = new Set(['c', 'cpp', 'csharp', 'java', 'kotlin', 'swift', 'dart', 'go', 'rust', 'php', 'scala']);

const DIRECT_FUNCTION_PATTERNS = {
  python: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/,
  ruby: /^\s*def\s+(?:self\.)?([A-Za-z_]\w*[!?=]?)/,
  php: /^\s*(?:(?:public|protected|private|static|final|abstract)\s+)*function\s*(?:&\s*)?([A-Za-z_]\w*)\s*\(/,
  go: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/,
  rust: /^\s*(?:(?:pub(?:\([^)]*\))?|async|unsafe|const|extern(?:\s+"[^"]+")?)\s+)*fn\s+([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\(/,
  kotlin: /^\s*(?:(?:public|private|protected|internal|override|suspend|inline|operator|infix)\s+)*fun\s+([A-Za-z_]\w*)\s*(?:<[^>]*>)?\s*\(/,
  scala: /(?:^|[;{]\s*)(?:(?:private|protected|override|final|implicit|lazy)\s+)*def\s+([A-Za-z_]\w*)\s*(?:\[[^\]]*\])?\s*\(/,
  swift: /^\s*(?:(?:public|private|internal|fileprivate|open|final|static|class|mutating|override|convenience)\s+)*(?:func|init)\s+([A-Za-z_]\w*)\s*\(/,
  lua: /^\s*(?:local\s+)?function\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\(/,
  shell: /^\s*(?:function\s+)?([A-Za-z_]\w*)\s*\(\s*\)\s*\{?/,
  powershell: /^\s*function\s+([A-Za-z_]\w*(?:-[A-Za-z_]\w*)*)/i,
  perl: /^\s*sub\s+([A-Za-z_]\w*)/,
  r: /^\s*([A-Za-z_]\w*)\s*(?:<-|=)\s*function\s*\(/i,
  sql: /^\s*create\s+(?:or\s+replace\s+)?(?:function|procedure|trigger)\s+([A-Za-z_]\w*)/i
};

const BRACE_FUNCTION_PATTERN = /^\s*(?:(?:public|private|protected|internal|static|final|abstract|virtual|override|async|suspend|inline|mutating|open|sealed|partial|constexpr|extern|friend|operator|const|volatile)\s+)*(?:[A-Za-z_$][A-Za-z0-9_$:<>.,?*&\[\]]*\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^(){};]*>)?\s*\([^;{}]*\)\s*(?:const\b[^{};]*)?(?:\{|;|$)/;

const TYPE_PATTERN = /^\s*(?:(?:(?:export|pub(?:\([^)]*\))?|public|private|protected|internal|abstract|final|sealed|partial|open|data|case|nested|file|static)\s+)*)(class|interface|enum|struct|union|trait|protocol|record|object|actor|namespace|module|extension)\s+([A-Za-z_]\w*)/;
const GO_TYPE_PATTERN = /^\s*type\s+([A-Za-z_]\w*)\s+(struct|interface)\b/;
const RUST_IMPL_PATTERN = /^\s*impl(?:\s*<[^>]*>)?\s+([A-Za-z_]\w*)/;
const TYPEDEF_PATTERN = /^\s*typedef\s+(?:struct|class|union)\s+([A-Za-z_]\w*)/;
const SQL_TYPE_PATTERN = /^\s*create\s+(?:table|view|type)\s+(?:if\s+not\s+exists\s+)?([A-Za-z_]\w*)/i;

function lineIndent(line) {
  return (String(line).match(/^\s*/) || [''])[0].replace(/\t/g, '    ').length;
}

function stripComments(line, language, state) {
  let value = String(line || '');
  if (state.block) {
    const close = value.indexOf('*/');
    if (close < 0) return '';
    value = value.slice(close + 2);
    state.block = false;
  }
  const trimmed = value.trimStart();
  if (HASH_COMMENT_LANGUAGES.has(language) && trimmed.startsWith('#')) return '';
  if (DASH_COMMENT_LANGUAGES.has(language) && trimmed.startsWith('--')) return '';
  if (C_STYLE_LANGUAGES.has(language) && trimmed.startsWith('//')) return '';
  if (C_STYLE_LANGUAGES.has(language)) {
    const start = value.indexOf('/*');
    if (start >= 0) {
      const close = value.indexOf('*/', start + 2);
      if (close < 0) {
        state.block = true;
        return value.slice(0, start);
      }
      value = `${value.slice(0, start)}${value.slice(close + 2)}`;
    }
  }
  return value;
}

function declarationEndLine(lines, startIndex, language) {
  if (['python', 'r', 'ruby'].includes(language)) {
    const baseIndent = lineIndent(lines[startIndex]);
    let end = startIndex;
    for (let index = startIndex + 1; index < lines.length; index += 1) {
      const value = lines[index];
      if (!value.trim()) continue;
      if (lineIndent(value) <= baseIndent && !/^\s*(?:else|elif|except|finally|case|when)\b/.test(value)) break;
      end = index;
    }
    return end + 1;
  }
  let balance = 0;
  let opened = false;
  let end = startIndex;
  for (let index = startIndex; index < lines.length; index += 1) {
    const value = lines[index];
    const opens = (value.match(/{/g) || []).length;
    const closes = (value.match(/}/g) || []).length;
    if (opens) opened = true;
    balance += opens - closes;
    if (opened && balance <= 0) return index + 1;
    end = index;
  }
  return end + 1;
}

function exportedDeclaration(code, name, language) {
  if (/\b(?:export|pub|public)\b/.test(code)) return true;
  return language === 'go' && /^[A-Z]/.test(name);
}

function pythonModuleSource(value) {
  const clean = String(value || '').trim();
  const dots = (clean.match(/^\.+/) || [''])[0].length;
  const name = clean.slice(dots).replaceAll('.', '/');
  if (!dots) return clean;
  return name ? `${'.'.repeat(dots)}/${name}` : '.'.repeat(dots);
}

function rustModuleSource(value) {
  const clean = String(value || '').trim().replace(/\s+as\s+[A-Za-z_]\w*$/, '').replace(/\s*\{.*$/, '').replace(/;$/, '').trim();
  if (!clean) return '';
  const parts = clean.split('::').filter(Boolean);
  if (parts[0] === 'crate' || parts[0] === 'self') return parts.length > 1 ? `./${parts.slice(1).join('/')}` : './';
  if (parts[0] === 'super') return parts.length > 1 ? `../${parts.slice(1).join('/')}` : '../';
  return clean.replaceAll('::', '/');
}

function quotedValue(value) {
  const match = String(value || '').match(/["']([^"']+)["']/);
  return match?.[1] || '';
}

function parseSpecifiers(value, { fromImport = false } = {}) {
  const clean = String(value || '').replace(/[;{}]/g, ' ').trim();
  if (!clean || clean === '*') return [];
  return clean.split(',').map((part) => part.trim()).map((part) => {
    const tokens = part.split(/\s+(?:as|=>)\s+|\s*=/i).map((token) => token.trim()).filter(Boolean);
    const imported = tokens[0]?.replace(/^\W+/, '');
    const local = tokens[1] || imported;
    if (!/^[A-Za-z_$][\w$]*$/.test(local || '') || !/^[A-Za-z_$][\w$]*$/.test(imported || '')) return null;
    return { imported, local };
  }).filter(Boolean).map((item) => (fromImport ? item : { ...item, imported: item.imported.split('.').at(-1) }));
}

function variableName(code, language) {
  const declaration = /^\s*(?:(?:export|pub(?:\([^)]*\))?|public|private|protected|static|readonly|volatile)\s+)*(?:const|let|var|static|final|readonly|mutable|mut)\s+(?:mut\s+)?\$?([A-Za-z_]\w*)\b/.exec(code);
  if (declaration) return declaration[1];
  if (language === 'php') return /^\s*\$([A-Za-z_]\w*)\s*=/.exec(code)?.[1] || null;
  if (['python', 'ruby', 'shell'].includes(language)) return /^\s*([A-Za-z_]\w*)\s*=\s*(?!function\b)/.exec(code)?.[1] || null;
  if (language === 'r') return /^\s*([A-Za-z_]\w*)\s*<-\s*(?!function\b)/.exec(code)?.[1] || null;
  if (language === 'lua') return /^\s*(?:local\s+)?([A-Za-z_]\w*)\s*=/.exec(code)?.[1] || null;
  if (language === 'go') return /^\s*(?:const|var)\s+([A-Za-z_]\w*)\b/.exec(code)?.[1] || null;
  if (['c', 'cpp', 'csharp', 'java', 'kotlin', 'swift', 'dart', 'scala'].includes(language)) {
    return /^\s*(?:(?:public|private|protected|internal|static|final|const|constexpr|readonly|volatile)\s+)*(?:[A-Za-z_]\w*(?:\s*<[^;=]+>)?[\s*&]+)([A-Za-z_]\w*)\s*(?:=|;)/.exec(code)?.[1] || null;
  }
  if (language === 'powershell') return /^\s*\$([A-Za-z_]\w*)\s*=/.exec(code)?.[1] || null;
  return null;
}

function baseNames(code, language) {
  const bases = [];
  const append = (value) => String(value || '').split(',').map((item) => item.trim().replace(/\s+(?:public|private|protected|virtual|override)\s+/g, ' ').trim()).map((item) => item.match(/[A-Za-z_]\w*$/)?.[0]).filter(Boolean).forEach((item) => { if (!bases.includes(item)) bases.push(item); });
  const extendsMatch = /\bextends\s+([^:{]+?)(?=\s+implements\b|\s*\{|$)/i.exec(code);
  if (extendsMatch) append(extendsMatch[1]);
  const implementsMatch = /\bimplements\s+([^:{]+?)(?=\s*\{|$)/i.exec(code);
  if (implementsMatch) append(implementsMatch[1]);
  if (['c', 'cpp', 'csharp', 'java', 'kotlin', 'swift', 'scala'].includes(language)) {
    const colonMatch = /:\s*([^\{]+)/.exec(code);
    if (colonMatch) append(colonMatch[1]);
  }
  if (language === 'python') {
    const parenthesized = /class\s+[A-Za-z_]\w*\s*\(([^)]*)\)/.exec(code);
    if (parenthesized) append(parenthesized[1]);
  }
  return bases;
}

function analyseProgramming(source, { filePath = '', language = 'generic' } = {}) {
  const text = String(source || '');
  const rawLines = text.split(/\r?\n/);
  const commentState = { block: false };
  const lines = rawLines.map((line) => stripComments(line, language, commentState));
  const symbols = [];
  const imports = [];
  const exports = [];
  const extendsRelations = [];
  const warnings = [];
  const calls = [];
  const symbolKeys = new Set();
  const importKeys = new Set();
  const exportKeys = new Set();
  const callKeys = new Set();
  const addSymbol = (name, kind, line, endLine = line, extra = {}, exported = false) => {
    const cleanName = String(name || '').trim();
    if (!cleanName || !/^[A-Za-z_$][\w$!?=.-]*$/.test(cleanName)) return null;
    const key = `${kind}:${cleanName}:${line}`;
    const existing = symbols.find((symbol) => symbol.name === cleanName && symbol.kind === kind && symbol.range.startLine === line);
    if (existing) {
      if (exported) existing.exported = true;
      return existing;
    }
    if (symbolKeys.has(key)) return symbols.find((symbol) => symbol.name === cleanName && symbol.kind === kind && symbol.range.startLine === line) || null;
    symbolKeys.add(key);
    const symbol = { name: cleanName, kind, range: { startLine: line, endLine: Math.max(line, endLine) }, ...extra, exported: Boolean(exported) };
    symbols.push(symbol);
    if (exported) {
      const exportKey = `${cleanName}:${line}`;
      if (!exportKeys.has(exportKey)) {
        exportKeys.add(exportKey);
        exports.push({ local: cleanName, exported: cleanName, line });
      }
    }
    return symbol;
  };
  const addImport = (sourceValue, line, { kind = 'imports', relativePath = false, modulePath = false, specifiers = [] } = {}) => {
    const cleanSource = String(sourceValue || '').trim().replace(/[;,]+$/, '');
    if (!cleanSource || cleanSource.startsWith('$') || cleanSource.includes('${')) return;
    const key = `${kind}:${cleanSource}:${line}`;
    if (importKeys.has(key)) return;
    importKeys.add(key);
    const record = { source: cleanSource, line, kind };
    if (relativePath) record.relativePath = true;
    if (modulePath) record.modulePath = true;
    if (specifiers.length) {
      record.specifiers = specifiers;
      specifiers.forEach((specifier) => addSymbol(specifier.local, 'import', line, line, { imported: specifier.imported, source: cleanSource }));
    }
    imports.push(record);
  };

  let goImportBlock = false;
  lines.forEach((code, index) => {
    const line = index + 1;
    const trimmed = code.trim();
    if (!trimmed) return;

    if (language === 'go') {
      if (/^\s*import\s*\(\s*$/.test(code)) { goImportBlock = true; return; }
      if (goImportBlock && /^\s*\)\s*$/.test(code)) { goImportBlock = false; return; }
      const goImport = goImportBlock
        ? /^\s*(?:(?:[A-Za-z_]\w*|\.)\s+)?["']([^"']+)["']/.exec(code)
        : /^\s*import\s+(?:(?:[A-Za-z_]\w*|\.)\s+)?["']([^"']+)["']/.exec(code);
      if (goImport) {
        addImport(goImport[1], line, { modulePath: true });
        return;
      }
    }

    if (language === 'python') {
      const from = /^\s*from\s+([.\w]+)\s+import\s+(.+)/.exec(code);
      if (from) {
        const sourceValue = pythonModuleSource(from[1]);
        addImport(sourceValue, line, { relativePath: sourceValue.startsWith('.'), modulePath: !sourceValue.startsWith('.'), specifiers: parseSpecifiers(from[2], { fromImport: true }) });
        return;
      }
      const imported = /^\s*import\s+(.+)/.exec(code);
      if (imported) {
        imported[1].split(',').map((item) => item.trim()).filter(Boolean).forEach((item) => {
          const match = /^([^\s]+)(?:\s+as\s+([A-Za-z_]\w*))?/.exec(item);
          if (!match) return;
          const sourceValue = pythonModuleSource(match[1]);
          const importedName = match[1].split('.').at(-1);
          addImport(sourceValue, line, { relativePath: sourceValue.startsWith('.'), modulePath: !sourceValue.startsWith('.'), specifiers: [{ imported: importedName, local: match[2] || importedName }] });
        });
        return;
      }
    }

    if (['java', 'kotlin', 'scala'].includes(language)) {
      const imported = /^\s*import\s+([A-Za-z_]\w*(?:[.$]\w*)*(?:\.\*)?)\s*;?/.exec(code);
      if (imported) {
        const importedName = imported[1].endsWith('.*') ? '' : imported[1].split(/[.$]/).at(-1);
        addImport(imported[1], line, { modulePath: true, specifiers: importedName ? [{ imported: importedName, local: importedName }] : [] });
        return;
      }
    }

    if (language === 'csharp') {
      const using = /^\s*using\s+(?:static\s+)?([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*;/.exec(code);
      if (using) {
        const importedName = using[1].split('.').at(-1);
        addImport(using[1], line, { modulePath: true, specifiers: [{ imported: importedName, local: importedName }] });
        return;
      }
    }

    if (language === 'php') {
      const required = /^\s*(?:require|require_once|include|include_once)\s*(?:\(\s*)?["']([^"']+)["']/.exec(code);
      if (required) { addImport(required[1], line, { kind: 'requires', relativePath: required[1].startsWith('.') || required[1].startsWith('/') }); return; }
      const use = /^\s*use\s+([^;{]+?)(?:\s+as\s+([A-Za-z_]\w*))?\s*;/.exec(code);
      if (use) {
        const sourceValue = use[1].trim();
        const importedName = sourceValue.split('\\').at(-1);
        addImport(sourceValue, line, { modulePath: true, specifiers: [{ imported: importedName, local: use[2] || importedName }] });
        return;
      }
    }

    if (['c', 'cpp'].includes(language)) {
      const include = /^\s*#\s*include\s*([<"])([^>"]+)[>"]/.exec(code);
      if (include) { addImport(include[2], line, { relativePath: include[1] === '"', modulePath: include[1] === '<' }); return; }
    }

    if (language === 'rust') {
      const module = /^\s*(?:pub\s+)?mod\s+([A-Za-z_]\w*)\s*;/.exec(code);
      if (module) { addImport(`./${module[1]}`, line, { relativePath: true }); return; }
      const used = /^\s*(?:pub\s+)?use\s+([^;]+);?/.exec(code);
      if (used) {
        const sourceValue = rustModuleSource(used[1]);
        addImport(sourceValue, line, { relativePath: sourceValue.startsWith('.') || sourceValue.startsWith('..'), modulePath: !sourceValue.startsWith('.'), specifiers: parseSpecifiers(used[1].split('::').at(-1), { fromImport: true }) });
        return;
      }
    }

    if (language === 'ruby') {
      const relative = /^\s*require_relative\s+(["'][^"']+["']|\S+)/.exec(code);
      if (relative) { addImport(quotedValue(relative[1]) || relative[1], line, { relativePath: true }); return; }
      const required = /^\s*require\s+(["'][^"']+["']|\S+)/.exec(code);
      if (required) { addImport(quotedValue(required[1]) || required[1], line, { modulePath: true }); return; }
    }

    if (language === 'dart') {
      const imported = /^\s*(?:import|export|part)\s+(["'][^"']+["'])/.exec(code);
      if (imported) {
        const sourceValue = quotedValue(imported[1]);
        const isRelative = !/^(?:dart|package):/i.test(sourceValue);
        addImport(sourceValue, line, { relativePath: isRelative, modulePath: !isRelative });
        return;
      }
    }

    if (language === 'lua') {
      const required = /\b(?:require|dofile)\s*\(\s*(["'][^"']+["'])\s*\)/.exec(code);
      if (required) { const sourceValue = quotedValue(required[1]).replaceAll('.', '/'); addImport(sourceValue, line, { relativePath: required[0].includes('dofile'), modulePath: !required[0].includes('dofile') }); return; }
    }

    if (language === 'shell') {
      const sourced = /^\s*(?:source|\.)\s+(["']?[^"'\s]+["']?)/.exec(code);
      if (sourced) { addImport(quotedValue(sourced[1]) || sourced[1], line, { relativePath: true, kind: 'requires' }); return; }
    }

    if (language === 'powershell') {
      const module = /^\s*Import-Module\s+(["']?[^"'\s]+["']?)/i.exec(code);
      if (module) { const sourceValue = quotedValue(module[1]) || module[1]; addImport(sourceValue, line, { relativePath: sourceValue.startsWith('.') || sourceValue.includes('\\') }); return; }
      const sourced = /^\s*\.\s+(["']?[^"'\s]+["']?)/.exec(code);
      if (sourced) { addImport(quotedValue(sourced[1]) || sourced[1], line, { relativePath: true, kind: 'requires' }); return; }
    }

    if (language === 'r') {
      const sourced = /^\s*source\s*\(\s*(["'][^"']+["'])/.exec(code);
      if (sourced) { addImport(quotedValue(sourced[1]), line, { relativePath: true, kind: 'requires' }); return; }
    }

    if (language === 'perl') {
      const used = /^\s*(?:use|require)\s+([A-Za-z_]\w*(?:::[A-Za-z_]\w*)*|["'][^"']+["'])/.exec(code);
      if (used) {
        const sourceValue = quotedValue(used[1]) || used[1].replaceAll('::', '/');
        addImport(sourceValue, line, { kind: code.trimStart().startsWith('require') ? 'requires' : 'imports', modulePath: !sourceValue.includes('/') || used[1].includes('::'), relativePath: sourceValue.startsWith('.') });
        return;
      }
    }

    if (language === 'sql') {
      const sourced = /^\s*(?:source|\\i)\s+(["']?[^"'\s;]+["']?)/i.exec(code);
      if (sourced) { addImport(quotedValue(sourced[1]) || sourced[1], line, { relativePath: true, kind: 'requires' }); return; }
    }

    const typeMatch = TYPE_PATTERN.exec(code) || GO_TYPE_PATTERN.exec(code) || RUST_IMPL_PATTERN.exec(code) || TYPEDEF_PATTERN.exec(code) || SQL_TYPE_PATTERN.exec(code);
    if (typeMatch) {
      const isGo = language === 'go' && GO_TYPE_PATTERN.test(code);
      const isImpl = language === 'rust' && RUST_IMPL_PATTERN.test(code);
      const isTypedef = ['c', 'cpp'].includes(language) && TYPEDEF_PATTERN.test(code);
      const isSql = language === 'sql' && SQL_TYPE_PATTERN.test(code);
      const kind = isSql ? 'type' : isImpl ? 'class' : isGo || isTypedef ? typeMatch[2] || 'type' : typeMatch[1];
      const name = isGo || isImpl || isTypedef || isSql ? typeMatch[1] : typeMatch[2];
      const symbol = addSymbol(name, kind, line, declarationEndLine(lines, index, language), {}, exportedDeclaration(code, name, language));
      if (symbol && !isImpl) baseNames(code, language).forEach((base) => extendsRelations.push({ fromName: symbol.name, targetName: base, line }));
    }

    const functionPattern = DIRECT_FUNCTION_PATTERNS[language] || (['c', 'cpp', 'csharp', 'java', 'dart', 'scala'].includes(language) ? BRACE_FUNCTION_PATTERN : null);
    const functionMatch = functionPattern?.exec(code);
    if (functionMatch) {
      const name = functionMatch[1];
      if (!CONTROL_CALLS.has(name.toLowerCase())) {
        const receiver = language === 'go' && /\bfunc\s*\(/.test(code);
        addSymbol(name, receiver ? 'method' : 'function', line, declarationEndLine(lines, index, language), {}, exportedDeclaration(code, name, language));
      }
    }

    const variable = variableName(code, language);
    if (variable && !symbols.some((symbol) => symbol.name === variable && symbol.range.startLine === line)) {
      addSymbol(variable, 'variable', line, line, {}, exportedDeclaration(code, variable, language));
    }
    if (language === 'php') {
      const namespace = /^\s*namespace\s+([^;{]+)/.exec(code);
      if (namespace) addSymbol(namespace[1].trim(), 'namespace', line, line, {}, false);
    }
  });

  const callableSymbols = symbols.filter((symbol) => ['function', 'method'].includes(symbol.kind));
  lines.forEach((code, index) => {
    if (!code.trim()) return;
    const line = index + 1;
    const declaration = callableSymbols.find((symbol) => symbol.range.startLine === line);
    const pattern = /\b([A-Za-z_$][\w$]*)\s*\(/g;
    let match;
    while ((match = pattern.exec(code))) {
      const targetName = match[1];
      if (CONTROL_CALLS.has(targetName.toLowerCase()) || (declaration && declaration.name === targetName)) continue;
      const owner = callableSymbols.filter((symbol) => symbol.range.startLine <= line && symbol.range.endLine >= line && symbol.name !== targetName).sort((first, second) => (first.range.endLine - first.range.startLine) - (second.range.endLine - second.range.startLine))[0];
      const key = `${owner?.name || ''}:${targetName}:${line}`;
      if (callKeys.has(key)) continue;
      callKeys.add(key);
      calls.push({ targetName, fromName: owner?.name || null, line });
    }
  });

  return {
    language,
    extension: path.extname(filePath).toLowerCase().slice(1),
    symbols: symbols.sort((first, second) => first.range.startLine - second.range.startLine || first.name.localeCompare(second.name)),
    imports,
    exports,
    calls,
    extendsRelations,
    warnings,
    lineCount: rawLines.length
  };
}

module.exports = { analyseProgramming, analyzeProgramming: analyseProgramming };
