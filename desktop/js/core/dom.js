export const $ = (selector, root = document) => root.querySelector(selector);

export const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  "'": '&#039;',
  '"': '&quot;'
}[character]));

export function bindClick(selector, handler, root = document) {
  root.querySelectorAll(selector).forEach((element) => element.addEventListener('click', handler));
}
