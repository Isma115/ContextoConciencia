import { PALETTES, savePalettePreference } from '../core/theme.js';
import { DIAGRAM_LINE_CONTRASTS, saveDiagramLineContrast } from '../core/diagram-settings.js';
import { showToast } from '../ui/notifications.js';

export function bindPreferencesMenu() {
  window.nexusData?.onPreferencesMenuAction?.((action, value) => {
    if (action === 'palette') {
      const selectedPalette = savePalettePreference(value);
      showToast(`Paleta aplicada: ${PALETTES[selectedPalette].label}`);
      return;
    }
    if (action === 'diagram-line-contrast') {
      const selectedContrast = saveDiagramLineContrast(value);
      showToast(`Contraste de líneas: ${DIAGRAM_LINE_CONTRASTS[selectedContrast].label}`);
    }
  });
}
