import { state } from './state.js';

const queryParams = new URLSearchParams(window.location.search);
const configuredBase = window.nexusData?.apiBase || queryParams.get('apiBase') || window.location.origin;
const API = `${configuredBase.replace(/\/$/, '')}/api`;
let unauthorizedHandler = null;

export function configureApi({ onUnauthorized } = {}) {
  unauthorizedHandler = onUnauthorized || null;
}

export function apiUrl(path) {
  return `${API}${path}`;
}

export async function api(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { error: text }; }
  if (!response.ok) {
    const error = new Error(payload.error || `Error ${response.status}`);
    error.status = response.status;
    if (response.status === 401 && state.user && !path.startsWith('/auth/')) unauthorizedHandler?.();
    throw error;
  }
  return payload;
}
