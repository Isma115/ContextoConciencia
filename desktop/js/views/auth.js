import { $, escapeHtml } from '../core/dom.js';
import { api } from '../core/api.js';
import { state } from '../core/state.js';

export function showApplication() {
  $('#auth-screen').classList.remove('visible');
  $('#auth-screen').innerHTML = '';
  $('.app-shell').classList.remove('app-hidden');
  $('.app-shell').setAttribute('aria-hidden', 'false');
  $('#active-user').textContent = state.user?.username || '';
  $('#logout-button').textContent = state.user?.offline ? 'Salir del modo offline' : 'Cerrar sesión';
}

export function showAuthentication(message = '', { onAuthenticated } = {}) {
  state.user = null;
  $('.app-shell').setAttribute('aria-hidden', 'true');
  $('.app-shell').classList.add('app-hidden');
  $('#auth-screen').classList.add('visible');
  $('#auth-screen').innerHTML = `<div class="auth-card"><div class="auth-brand"><strong>NexusData</strong></div><h1>Accede a tu espacio</h1><div class="auth-tabs"><button class="auth-tab active" data-auth-mode="login">Iniciar sesión</button><button class="auth-tab" data-auth-mode="register">Crear cuenta</button></div><form id="auth-form" class="auth-form" novalidate><label class="form-label">Usuario<input id="auth-username" class="field" autocomplete="username" minlength="3" maxlength="50" required /></label><label class="form-label">Contraseña<input id="auth-password" type="password" class="field" autocomplete="current-password" minlength="8" maxlength="32" required /></label><p id="auth-error" class="auth-error">${escapeHtml(message)}</p><button id="auth-submit" class="btn btn-primary auth-submit" type="submit">Iniciar sesión</button></form><div class="auth-offline"><button id="auth-offline" class="btn btn-secondary" type="button">Entrar offline</button></div></div>`;
  let mode = 'login';
  const updateMode = () => {
    document.querySelectorAll('[data-auth-mode]').forEach((button) => button.classList.toggle('active', button.dataset.authMode === mode));
    $('#auth-submit').textContent = mode === 'login' ? 'Iniciar sesión' : 'Crear cuenta';
    $('#auth-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    $('#auth-error').textContent = '';
  };
  document.querySelectorAll('[data-auth-mode]').forEach((button) => button.addEventListener('click', () => { mode = button.dataset.authMode; updateMode(); }));
  $('#auth-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const username = $('#auth-username').value;
    const password = $('#auth-password').value;
    const submit = $('#auth-submit');
    submit.disabled = true;
    try {
      const result = await api(`/auth/${mode === 'login' ? 'login' : 'register'}`, { method: 'POST', body: JSON.stringify({ username, password }) });
      state.user = result.user;
      await onAuthenticated?.();
    } catch (error) { $('#auth-error').textContent = error.message; }
    finally { submit.disabled = false; }
  });
  $('#auth-offline').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      const result = await api('/auth/offline', { method: 'POST' });
      state.user = result.user;
      await onAuthenticated?.();
    } catch (error) {
      $('#auth-error').textContent = error.message;
    } finally { button.disabled = false; }
  });
  updateMode();
  $('#auth-username').focus();
}
