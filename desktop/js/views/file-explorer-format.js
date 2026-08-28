function compareText(first, second) {
  return new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare(String(first || ''), String(second || ''));
}

export function pathName(filePath) {
  const raw = String(filePath || '').replace(/[\\/]+$/, '');
  return raw.split(/[\\/]/).filter(Boolean).pop() || filePath || 'Este equipo';
}

export function formatBytes(value) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function formatModifiedAt(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('es-ES', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));
  } catch {
    return '';
  }
}

const FILE_EXPLORER_ICON_MARKUP = Object.freeze({
  folder: '<path d="M4 8.5h8.5l2.5 3H28v12.8H4z" fill="currentColor" fill-opacity=".16"/><path d="M4 8.5h8.5l2.5 3H28v12.8H4z"/><path d="M4 12h24"/>',
  drive: '<rect x="3.5" y="6" width="25" height="18" rx="2"/><path d="M6.5 10h19M7 19h.01M11 19h.01M15 19h.01"/>',
  home: '<path d="m4 14 12-9 12 9"/><path d="M6.5 12.5V27h19V12.5M12.5 27v-8h7v8"/>',
  link: '<path d="m13 19-2 2a4.25 4.25 0 0 1-6-6l3-3a4.25 4.25 0 0 1 6-0.1"/><path d="m19 13 2-2a4.25 4.25 0 0 0-6-6l-3 3a4.25 4.25 0 0 0-.1 6"/><path d="m11 16 10-10"/>',
  code: '<path d="M6 4h12l8 8v16H6z"/><path d="M18 4v8h8M11 17l-2.5 2.5L11 22M21 17l2.5 2.5L21 22M18 16l-4 7"/>',
  document: '<path d="M6 4h12l8 8v16H6z"/><path d="M18 4v8h8M10 17h8M10 21h8M10 25h5"/>',
  data: '<ellipse cx="16" cy="8" rx="10" ry="4"/><path d="M6 8v12c0 2.2 4.5 4 10 4s10-1.8 10-4V8M6 14c0 2.2 4.5 4 10 4s10-1.8 10-4"/>',
  image: '<rect x="4" y="5" width="24" height="22" rx="2"/><circle cx="11" cy="11" r="2"/><path d="m6.5 24 6.5-7 4.5 4 3-3 5 6"/>',
  archive: '<path d="M5 9h22v18H5z"/><path d="M3.5 5h25v5h-25zM14 15h4"/>',
  media: '<rect x="4" y="5" width="24" height="22" rx="3"/><path d="m13 11 8 5-8 5z" fill="currentColor" stroke="none"/>',
  font: '<path d="M6 4h20v24H6z"/><path d="M18 4v5h8M10 25l4.5-13h2L21 25M11.5 21h8"/>',
  generic: '<path d="M6 4h12l8 8v16H6z"/><path d="M18 4v8h8M10 18h8M10 22h8M10 26h5"/>'
});

export function fileExplorerIconMarkup(tone) {
  const icon = FILE_EXPLORER_ICON_MARKUP[tone] || FILE_EXPLORER_ICON_MARKUP.generic;
  return `<svg viewBox="0 0 32 32" focusable="false" aria-hidden="true">${icon}</svg>`;
}

export function entryIcon(entry) {
  return fileExplorerIconMarkup(entryIconTone(entry));
}

export function entryIconTone(entry) {
  if (entry.kind === 'directory') return 'folder';
  if (entry.kind === 'link') return 'link';
  const extension = String(entry.extension || '').toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif', 'heic'].includes(extension)) return 'image';
  if (['mp4', 'mkv', 'mov', 'avi', 'webm', 'ogv', 'mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'].includes(extension)) return 'media';
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'].includes(extension)) return 'archive';
  if (['ttf', 'otf', 'woff', 'woff2', 'eot'].includes(extension)) return 'font';
  if (['json', 'csv', 'xml', 'yaml', 'yml', 'toml', 'ini', 'env', 'db', 'sqlite', 'sqlite3'].includes(extension)) return 'data';
  if (['md', 'markdown', 'txt', 'pdf', 'doc', 'docx', 'odt', 'rtf', 'epub'].includes(extension)) return 'document';
  if (['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'py', 'java', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'go', 'rs', 'php', 'rb', 'swift', 'kt', 'kts', 'sh', 'bash', 'zsh', 'sql', 'css', 'scss', 'less', 'html', 'htm', 'vue', 'svelte'].includes(extension)) return 'code';
  return 'generic';
}

export function rootIconTone(root) {
  if (root.kind === 'drive') return 'drive';
  if (root.label === 'Inicio') return 'home';
  return 'folder';
}

export function entryTypeLabel(entry) {
  if (entry.kind === 'directory') return 'Carpeta';
  if (entry.kind === 'link') return 'Enlace';
  return entry.extension ? `.${entry.extension.toUpperCase()}` : 'Fichero';
}

export function entrySecondaryText(entry, { search = false } = {}) {
  if (entry.kind === 'directory') return search && entry.relativePath ? entry.relativePath : 'Carpeta';
  if (entry.kind === 'link') return 'Enlace';
  const details = [];
  if (search && entry.relativePath) details.push(entry.relativePath);
  if (entry.extension) details.push(`.${entry.extension.toUpperCase()}`);
  details.push(formatBytes(entry.size));
  const modified = formatModifiedAt(entry.modifiedAt);
  if (modified) details.push(modified);
  return details.join(' · ');
}

export function visibleFileExplorerEntries(state) {
  const entries = state.entries.filter((entry) => state.showHidden || entry.hidden !== true);
  const direction = state.sortDirection === 'desc' ? -1 : 1;
  const sortValue = (entry) => {
    if (state.sortBy === 'type') return entry.extension || (entry.kind === 'directory' ? '0-folder' : '1-file');
    if (state.sortBy === 'size') return Number.isFinite(Number(entry.size)) ? Number(entry.size) : -1;
    if (state.sortBy === 'modified') return entry.modifiedAt ? new Date(entry.modifiedAt).getTime() : 0;
    return entry.name;
  };
  return [...entries].sort((first, second) => {
    const firstDirectory = first.kind === 'directory' ? 0 : 1;
    const secondDirectory = second.kind === 'directory' ? 0 : 1;
    if (firstDirectory !== secondDirectory) return firstDirectory - secondDirectory;
    const firstValue = sortValue(first);
    const secondValue = sortValue(second);
    const comparison = typeof firstValue === 'number' && typeof secondValue === 'number'
      ? firstValue - secondValue
      : compareText(firstValue, secondValue);
    return comparison * direction || compareText(first.name, second.name);
  });
}

export function breadcrumbSegments(filePath) {
  const value = String(filePath || '');
  if (!value) return [];
  const windowsPath = /^[A-Za-z]:/.test(value) || value.includes('\\');
  const separator = windowsPath ? '\\' : '/';
  const normalised = value.replace(/[\\/]+/g, separator);
  let root = '';
  let remainder = normalised;
  if (windowsPath && /^[A-Za-z]:/.test(normalised)) {
    root = `${normalised.slice(0, 2)}${separator}`;
    remainder = normalised.slice(3);
  } else if (!windowsPath && normalised.startsWith('/')) {
    root = '/';
    remainder = normalised.slice(1);
  }
  const segments = [];
  if (root) segments.push({ label: root === '/' ? 'Sistema' : root, path: root });
  let current = root;
  remainder.split(separator).filter(Boolean).forEach((part) => {
    current = current ? `${current}${current.endsWith(separator) ? '' : separator}${part}` : part;
    segments.push({ label: part, path: current });
  });
  return segments;
}

export function selectionSummary(state) {
  const count = state.selectedPaths.size;
  if (!count) return 'Sin selección';
  return `${count} elemento${count === 1 ? '' : 's'} seleccionado${count === 1 ? '' : 's'}`;
}
