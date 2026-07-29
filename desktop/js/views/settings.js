import { $, escapeHtml } from '../core/dom.js';
import { state } from '../core/state.js';
import { shortDate } from '../core/format.js';

let refreshData = async () => {};

export function configureSettings({ onRefresh } = {}) {
  refreshData = onRefresh || refreshData;
}

export function renderSettings() {
  const user = state.user || {};
  const stats = state.stats || {};
  const offline = user.offline === true;
  const endpoint = String(window.nexusData?.apiBase || window.location.origin).replace(/^https?:\/\//i, '');
  const sessionStatus = offline ? 'Modo offline' : 'Conectado';
  const sessionClass = offline ? 'pill syncing' : 'pill ready';

  $('#view-settings').innerHTML = `<div class="section-top settings-top"><div><h1>Configuración</h1><p class="lead">Estado de la sesión, del índice y de la aplicación.</p></div><button id="settings-refresh" class="btn btn-secondary" type="button">↻ Actualizar estado</button></div><div class="settings-grid"><section class="panel settings-panel"><div class="panel-header settings-panel-header"><div><h2>Sesión</h2><p>Identidad y conexión actual.</p></div><span class="${sessionClass}">${sessionStatus}</span></div><div class="setting-row"><div><div class="setting-label">Usuario</div><div class="setting-help">Cuenta activa en esta ventana</div></div><span class="setting-value">${escapeHtml(user.username || 'Sin identificar')}</span></div><div class="setting-row"><div><div class="setting-label">Modo</div><div class="setting-help">Origen de los recursos visibles</div></div><span class="setting-value">${offline ? 'Solo local' : 'Online'}</span></div><div class="setting-row"><div><div class="setting-label">Servidor</div><div class="setting-help">API local de la aplicación</div></div><span class="setting-value" title="${escapeHtml(endpoint)}">${escapeHtml(endpoint)}</span></div></section><section class="panel settings-panel"><div class="panel-header settings-panel-header"><div><h2>Índice</h2><p>Recursos disponibles para buscar.</p></div><span class="check">Activo</span></div><div class="setting-row"><div class="setting-label">Documentos</div><span class="setting-value">${Number(stats.documents) || 0}</span></div><div class="setting-row"><div class="setting-label">Fuentes</div><span class="setting-value">${Number(stats.sources) || state.sources.length}</span></div><div class="setting-row"><div class="setting-label">Colecciones</div><span class="setting-value">${Number(stats.collections) || state.collections.length}</span></div><div class="setting-row"><div class="setting-label">Etiquetas</div><span class="setting-value">${state.tags.length}</span></div><div class="setting-row"><div class="setting-label">Última sincronización</div><span class="setting-value">${escapeHtml(shortDate(stats.lastSyncAt))}</span></div></section><section class="panel settings-panel"><div class="panel-header settings-panel-header"><div><h2>Seguridad</h2><p>Protecciones activas del escritorio.</p></div><span class="check">Protegida</span></div><div class="setting-row"><div class="setting-label">Node integration</div><span class="check">Off</span></div><div class="setting-row"><div class="setting-label">Context isolation</div><span class="check">On</span></div><div class="setting-row"><div class="setting-label">Sandbox del renderer</div><span class="check">On</span></div><div class="setting-row"><div class="setting-label">Credenciales</div><span class="setting-value">Ocultas</span></div></section><section class="panel settings-panel"><div class="panel-header settings-panel-header"><div><h2>Componentes</h2><p>Servicios utilizados por NexusData.</p></div></div><div class="setting-row"><div class="setting-label">Electron</div><span class="check">Activo</span></div><div class="setting-row"><div class="setting-label">Express</div><span class="check">Activo</span></div><div class="setting-row"><div class="setting-label">SQLite</div><span class="check">Activo</span></div><div class="setting-row"><div class="setting-label">Fuse.js</div><span class="check">Activo</span></div></section></div>`;
  $('#settings-refresh').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = 'Actualizando…';
    try { await refreshData(); } finally { button.disabled = false; }
  });
}
