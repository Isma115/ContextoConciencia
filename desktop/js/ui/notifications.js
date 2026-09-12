import { $, escapeHtml } from '../core/dom.js';

export function showToast(message, error = false, { replaceKey = '' } = {}) {
  const region = $('#toast-region');
  if (!region) return;
  if (replaceKey) {
    region.querySelectorAll('.toast').forEach((toast) => {
      if (toast.dataset.toastKey === replaceKey) toast.remove();
    });
  }
  const toast = document.createElement('div');
  toast.className = `toast${error ? ' error' : ''}`;
  if (replaceKey) toast.dataset.toastKey = replaceKey;
  toast.textContent = message;
  region.appendChild(toast);
  setTimeout(() => toast.remove(), 4200);
}

export function setConnection(status, text) {
  const node = $('#api-status');
  if (!node) return;
  node.className = `connection-status ${status}`;
  node.innerHTML = `<i></i>${escapeHtml(text)}`;
}
