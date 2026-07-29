import { $ } from '../core/dom.js';

export function closeModal() {
  $('#modal-root').innerHTML = '';
}

export function bindModalClose() {
  document.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', closeModal));
}
