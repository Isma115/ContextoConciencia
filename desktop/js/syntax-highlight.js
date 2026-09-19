(function exposeSyntaxHighlighter(root) {
  'use strict';

  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[character]));

  const EXTENSION_LANGUAGES = Object.freeze({
    js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
    ts: 'typescript', tsx: 'typescript', py: 'python', pyw: 'python', java: 'java',
    cs: 'csharp', c: 'c', h: 'c', cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hh: 'cpp', hpp: 'cpp', hxx: 'cpp',
    go: 'go', rs: 'rust', php: 'php', phtml: 'php', rb: 'ruby', rake: 'ruby', gemspec: 'ruby',
    kt: 'kotlin', kts: 'kotlin', swift: 'swift', dart: 'dart', lua: 'lua', r: 'r',
    scala: 'scala', sc: 'scala', pl: 'perl', pm: 'perl', sh: 'shell', bash: 'shell', zsh: 'shell', fish: 'shell',
    ps1: 'powershell', psm1: 'powershell', sql: 'sql', html: 'html', htm: 'html', css: 'css', json: 'json'
  });

  const KEYWORDS = Object.freeze({
    javascript: 'as async await break case catch class const continue debugger default delete do else export extends finally for from function get if implements import in instanceof interface let new of package private protected public return set static super switch throw try typeof undefined var void while with yield',
    typescript: 'abstract any as asserts async await bigint boolean break case catch class const constructor continue declare default delete do else enum export extends false finally for from function get if implements import in infer instanceof interface is keyof let module namespace never new null number object of override private protected public readonly require return set static string super switch symbol this throw true try type typeof undefined unique unknown var void while with yield',
    python: 'and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield',
    java: 'abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new null package private protected public return short static strictfp super switch synchronized this throw throws transient true try void volatile while false',
    csharp: 'abstract as base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach goto if implicit in int interface internal is lock long namespace new null object operator out override params private protected public readonly ref return sbyte sealed short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using virtual void volatile while async await var dynamic record init',
    c: 'auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while',
    cpp: 'alignas alignof and asm auto bitand bitor bool break case catch char class compl concept const consteval constexpr constinit const_cast continue co_await co_return co_yield decltype default delete do double dynamic_cast else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept not nullptr operator or private protected public register reinterpret_cast requires return short signed sizeof static static_assert static_cast struct switch template this thread_local throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while xor',
    go: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var',
    rust: 'as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while',
    php: 'abstract and array as break callable case catch class clone const continue declare default die do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile eval exit extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new null or print private protected public readonly require require_once return static switch throw trait true try unset use var while xor yield false',
    ruby: 'alias and begin break case class def defined do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield',
    kotlin: 'as break class continue do else false for fun if in interface is null object package return super this throw true try typealias typeof val var when while by catch constructor delegate dynamic field file finally get import init param property receiver set setparam where actual abstract annotation companion const crossinline data enum expect external final infix inline inner internal lateinit noinline open operator out override private protected public reified sealed suspend tailrec vararg',
    swift: 'associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private protocol public rethrows static struct subscript typealias var break case continue default defer do else fallthrough for guard if in repeat return switch where while as Any catch false is nil super self Self throw throws true try',
    dart: 'abstract as assert async await break case catch class const continue covariant default deferred do dynamic else enum export extends extension external factory false final finally for Function get hide if implements import in interface is late library mixin new null on operator part required rethrow return set show static super switch sync this throw true try typedef var void while with yield',
    lua: 'and break do else elseif end false for function goto if in local nil not or repeat return then true until while',
    r: 'break else FALSE for function if in Inf NA NaN next NULL repeat return TRUE while',
    scala: 'abstract case catch class def do else extends false final finally for forSome if implicit import lazy match new null object override package private protected return sealed super this throw trait true try type val var while with yield',
    perl: 'break continue do else elsif for foreach given goto if last local my next no our package redo require return state sub unless until use when while',
    shell: 'case do done elif else esac fi for function if in select then time until while',
    powershell: 'begin break catch class continue data define do dynamicparam else elseif end enum exit filter finally for foreach from function hidden if in inlinescript parallel param process return sequence static switch throw trap try until using var while workflow',
    sql: 'add all alter and any as asc backup between by case check column constraint create database default delete desc distinct drop exec exists foreign from full group having in index inner insert into is join key left like limit not null or order outer primary procedure right rownum select set table top truncate union unique update values view where',
    css: '@charset @container @font-face @import @keyframes @layer @media @namespace @page @property @supports',
    json: 'true false null'
  });

  const keywordSets = Object.fromEntries(Object.entries(KEYWORDS).map(([language, words]) => [language, new Set(words.split(/\s+/))]));
  const C_STYLE = new Set(['javascript', 'typescript', 'java', 'csharp', 'c', 'cpp', 'go', 'rust', 'php', 'kotlin', 'swift', 'dart', 'scala']);
  const HASH_COMMENT = new Set(['python', 'ruby', 'r', 'perl', 'shell', 'powershell']);
  const DASH_COMMENT = new Set(['lua', 'sql']);

  function languageFor(document = {}) {
    const type = String(document.type || '').toLowerCase();
    if (EXTENSION_LANGUAGES[type]) return EXTENSION_LANGUAGES[type];
    if (Object.hasOwn(KEYWORDS, type) || type === 'html') return type;
    const metadataExtension = String(document.metadata?.extension || '').toLowerCase().replace(/^\./, '');
    if (EXTENSION_LANGUAGES[metadataExtension]) return EXTENSION_LANGUAGES[metadataExtension];
    const path = String(document.path || '');
    const match = path.match(/\.([^.\\/]+)$/);
    return match ? EXTENSION_LANGUAGES[match[1].toLowerCase()] || '' : '';
  }

  function token(type, value) {
    return `<span class="syntax-${type}">${escapeHtml(value)}</span>`;
  }

  function readQuoted(source, start, quote) {
    let index = start + quote.length;
    while (index < source.length) {
      if (source[index] === '\\') { index += 2; continue; }
      if (source.startsWith(quote, index)) return index + quote.length;
      index += 1;
    }
    return source.length;
  }

  function highlightHtmlAttributes(value) {
    const pattern = /([\w:-]+)(\s*=\s*)(?:("[^"]*")|('[^']*')|([^\s>]+))/g;
    let output = '';
    let cursor = 0;
    for (const match of value.matchAll(pattern)) {
      output += escapeHtml(value.slice(cursor, match.index));
      output += `${token('attribute', match[1])}${escapeHtml(match[2])}${token('string', match[3] || match[4] || match[5])}`;
      cursor = match.index + match[0].length;
    }
    return output + escapeHtml(value.slice(cursor));
  }

  function highlightHtml(source) {
    const parts = String(source).split(/(<!--[\s\S]*?-->|<!DOCTYPE[^>]*>|<\/?[A-Za-z][^>]*>)/gi);
    return parts.map((part) => {
      if (!part.startsWith('<')) return escapeHtml(part);
      if (part.startsWith('<!--')) return token('comment', part);
      if (/^<!doctype/i.test(part)) return token('keyword', part);
      const match = part.match(/^(<\/?)([\w:-]+)([\s\S]*?)(\/?>)$/);
      if (!match) return escapeHtml(part);
      return `${token('punctuation', match[1])}${token('tag', match[2])}${highlightHtmlAttributes(match[3])}${token('punctuation', match[4])}`;
    }).join('');
  }

  function highlight(source, language) {
    const input = String(source ?? '');
    if (language === 'html') return highlightHtml(input);
    const keywords = keywordSets[language] || new Set();
    let output = '';
    let index = 0;

    while (index < input.length) {
      const rest = input.slice(index);
      if (C_STYLE.has(language) && rest.startsWith('//')) {
        const end = input.indexOf('\n', index);
        const stop = end < 0 ? input.length : end;
        output += token('comment', input.slice(index, stop)); index = stop; continue;
      }
      if ((C_STYLE.has(language) || language === 'css') && rest.startsWith('/*')) {
        const end = input.indexOf('*/', index + 2);
        const stop = end < 0 ? input.length : end + 2;
        output += token('comment', input.slice(index, stop)); index = stop; continue;
      }
      if (HASH_COMMENT.has(language) && input[index] === '#') {
        const end = input.indexOf('\n', index);
        const stop = end < 0 ? input.length : end;
        output += token('comment', input.slice(index, stop)); index = stop; continue;
      }
      if (DASH_COMMENT.has(language) && rest.startsWith('--')) {
        const end = input.indexOf('\n', index);
        const stop = end < 0 ? input.length : end;
        output += token('comment', input.slice(index, stop)); index = stop; continue;
      }
      if (input[index] === '"' || input[index] === "'" || input[index] === '`') {
        const end = readQuoted(input, index, input[index]);
        const value = input.slice(index, end);
        const after = input.slice(end);
        const kind = language === 'json' && /^\s*:/.test(after) ? 'property' : 'string';
        output += token(kind, value); index = end; continue;
      }
      const number = rest.match(/^(?:0[xob][\da-f]+|\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i);
      if (number) { output += token('number', number[0]); index += number[0].length; continue; }
      const word = rest.match(/^[A-Za-z_$@][\w$@-]*/);
      if (word) {
        const value = word[0];
        const comparable = language === 'sql' ? value.toLowerCase() : value;
        let kind = keywords.has(comparable) ? 'keyword' : '';
        if (!kind && /^[A-Z]/.test(value) && !['css', 'sql'].includes(language)) kind = 'type';
        if (!kind && /^\s*\(/.test(rest.slice(value.length))) kind = 'function';
        output += kind ? token(kind, value) : escapeHtml(value);
        index += value.length; continue;
      }
      if (/[{}()[\].,;:]/.test(input[index])) output += token('punctuation', input[index]);
      else if (/[+\-*\/%=&|!<>?~^]/.test(input[index])) output += token('operator', input[index]);
      else output += escapeHtml(input[index]);
      index += 1;
    }
    return output;
  }

  const api = { highlight, languageFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.NexusSyntaxHighlight = api;
}(typeof window !== 'undefined' ? window : globalThis));
