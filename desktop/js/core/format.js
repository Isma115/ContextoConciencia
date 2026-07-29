export function shortDate(value) {
  if (!value) return 'Sin sincronizar';
  try { return new Intl.DateTimeFormat('es-ES', { day: '2-digit', month: 'short' }).format(new Date(value)); } catch { return value; }
}

export function typeLabel(type) {
  return ({ markdown: 'md', json: 'json', csv: 'csv', text: 'txt', html: 'html', css: 'css', javascript: 'js', rest: 'api' }[type] || type || 'doc');
}

export function statusLabel(status) {
  return ({ ready: 'Lista', pending: 'Pendiente', syncing: 'Sincronizando', error: 'Con errores' }[status] || status);
}

export function sourceIcon(type) { return type === 'rest' ? '↗' : '▤'; }

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
