export function shortDate(value) {
  if (!value) return 'Sin sincronizar';
  try { return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short' }).format(new Date(value)); } catch { return value; }
}

export function typeLabel(type) {
  return ({ markdown: 'md', json: 'json', csv: 'csv', text: 'txt', html: 'html', css: 'css', javascript: 'js', diagram: 'nxd', rest: 'api' }[type] || type || 'doc');
}

export function documentTypeClass(type) {
  return ({ markdown: 'markdown', json: 'json', csv: 'csv', text: 'text', html: 'html', css: 'css', javascript: 'javascript', diagram: 'diagram', rest: 'rest' }[type] || 'generic');
}

export function statusLabel(status) {
  return ({ ready: 'Lista', pending: 'Pendiente', syncing: 'Sincronizando', error: 'Con errores' }[status] || status);
}

const SOURCE_ICONS = Object.freeze({
  local: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3.5 7.5h6l2 2h9v8.25A1.75 1.75 0 0 1 18.75 19.5H5.25A1.75 1.75 0 0 1 3.5 17.75Z"></path><path d="M3.5 7.5V6.75A1.75 1.75 0 0 1 5.25 5h4l2 2h3"></path></svg>',
  rest: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="6" cy="6" r="2"></circle><circle cx="18" cy="6" r="2"></circle><circle cx="12" cy="18" r="2"></circle><path d="M8 6h8M7.25 7.5l3.5 8M16.75 7.5l-3.5 8"></path></svg>',
  generic: '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="8"></circle><path d="M12 8v8M8 12h8"></path></svg>'
});

export function sourceIcon(type) { return SOURCE_ICONS[type] || SOURCE_ICONS.generic; }

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
