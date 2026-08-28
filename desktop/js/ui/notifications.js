import { $, escapeHtml } from '../core/dom.js';

export function showToast(message, error = false) {
  if (!error) return;
  const toast = document.createElement('div');
  toast.className = `toast${error ? ' error' : ''}`;
  toast.textContent = message;
  $('#toast-region').appendChild(toast);
  setTimeout(() => toast.remove(), 4200);
}

export function setConnection(status, text) {
  const node = $('#api-status');
  node.className = `connection-status ${status}`;
  node.innerHTML = `<i></i>${escapeHtml(text)}`;
}
