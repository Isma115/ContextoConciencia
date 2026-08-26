import { $ } from '../core/dom.js';
import { state } from '../core/state.js';

export function showApplication() {
  const authScreen = $('#auth-screen');
  authScreen?.classList.remove('visible');
  authScreen?.setAttribute('hidden', '');
  authScreen?.setAttribute('aria-hidden', 'true');
  $('.app-shell').classList.remove('app-hidden');
  $('.app-shell').setAttribute('aria-hidden', 'false');
  $('#active-user').textContent = state.user?.username || '';
}

export function showAuthentication() {
  // La autenticación visual queda desactivada mientras la aplicación sea offline.
  showApplication();
}
