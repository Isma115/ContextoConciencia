import { PALETTES, savePalettePreference } from '../core/theme.js';
import { showToast } from '../ui/notifications.js';

export function bindPreferencesMenu() {
  window.nexusData?.onPreferencesMenuAction?.((action, value) => {
    if (action !== 'palette') return;
    const selectedPalette = savePalettePreference(value);
    showToast(`Paleta aplicada: ${PALETTES[selectedPalette].label}`);
  });
}
