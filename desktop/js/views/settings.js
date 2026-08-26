import { $, escapeHtml } from '../core/dom.js';
import { state } from '../core/state.js';
import { currentPalette, PALETTES, savePalettePreference } from '../core/theme.js';
import { showToast } from '../ui/notifications.js';

export function configureSettings() {}

export function renderSettings() {
  const user = state.user || {};
  const offline = user.offline === true;
  const palette = currentPalette();
  const paletteOptions = Object.entries(PALETTES)
    .map(([value, option]) => `<option value="${value}" ${value === palette ? 'selected' : ''}>${escapeHtml(option.label)}</option>`)
    .join('');

  $('#view-settings').innerHTML = `<div class="section-top settings-top"><div><h1>Configuración</h1><p class="lead">Gestiona tu cuenta y tus preferencias de uso.</p></div></div><div class="settings-grid settings-grid-single"><section class="panel settings-panel"><div class="panel-header settings-panel-header"><div><h2>Cuenta</h2><p>Información de la sesión actual.</p></div></div><div class="setting-row"><div><div class="setting-label">Usuario</div><div class="setting-help">Cuenta activa en esta ventana</div></div><span class="setting-value">${escapeHtml(user.username || 'Sin identificar')}</span></div><div class="setting-row"><div><div class="setting-label">Modo de acceso</div><div class="setting-help">Origen de los recursos que puedes consultar</div></div><span class="setting-value">${offline ? 'Solo local' : 'Online'}</span></div></section><section class="panel settings-panel"><div class="panel-header settings-panel-header"><div><h2>Preferencias</h2><p>Comportamiento de la aplicación.</p></div></div><div class="setting-row"><div><div class="setting-label">Preferencias de búsqueda</div><div class="setting-help">Tus consultas y filtros se guardan automáticamente en este dispositivo.</div></div><span class="check">Activo</span></div><div class="setting-row settings-palette-row"><div><div class="setting-label">Paleta de colores</div><div class="setting-help">Se aplica al instante y se conserva para la próxima ejecución.</div></div><select id="palette-select" class="select settings-palette-select" aria-label="Paleta de colores">${paletteOptions}</select></div></section></div>`;

  $('#palette-select')?.addEventListener('change', (event) => {
    const selectedPalette = savePalettePreference(event.target.value);
    showToast(`Paleta aplicada: ${PALETTES[selectedPalette].label}`);
  });
}
