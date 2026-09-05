import { $ } from '../core/dom.js';
import { PALETTES, savePalettePreference } from '../core/theme.js';
import {
  currentDiagramFontSize,
  DIAGRAM_FONT_SIZES,
  DIAGRAM_LINE_CONTRASTS,
  saveDiagramFontSize,
  saveDiagramLineContrast
} from '../core/diagram-settings.js';
import { bindModalClose, closeModal } from '../ui/modals.js';
import { showToast } from '../ui/notifications.js';

function diagramFontSizeModalMarkup(selectedSize) {
  const options = Object.entries(DIAGRAM_FONT_SIZES).map(([value, option]) => `<label class="diagram-font-size-option" data-diagram-font-size-option="${value}"><input type="radio" name="diagram-font-size" value="${value}"${value === selectedSize ? ' checked' : ''}><span class="diagram-font-size-option-copy"><strong>${option.label}</strong><small>${Math.round(option.scale * 100)}% del tamaño base</small></span><span class="diagram-font-size-sample" aria-hidden="true">Aa · Nodo</span></label>`).join('');
  return `<div id="diagram-font-size-modal" class="modal-backdrop"><div class="modal diagram-font-size-modal" role="dialog" aria-modal="true" aria-labelledby="diagram-font-size-title" aria-describedby="diagram-font-size-description"><div class="modal-head"><div><h2 id="diagram-font-size-title">Estilo de letra</h2></div><button class="modal-close" data-close-modal aria-label="Cerrar">×</button></div><div class="modal-body"><p id="diagram-font-size-description" class="diagram-font-size-description">Elige el tamaño para las etiquetas, descripciones y textos de las conexiones de los diagramas.</p><fieldset class="diagram-font-size-options"><legend>Tamaño del texto</legend>${options}</fieldset></div><div class="modal-actions"><button id="diagram-font-size-cancel" class="btn btn-secondary" data-close-modal type="button">Cancelar</button><button id="diagram-font-size-apply" class="btn btn-primary" type="button">Aplicar</button></div></div></div>`;
}

function openDiagramFontSizeModal() {
  $('#modal-root').innerHTML = diagramFontSizeModalMarkup(currentDiagramFontSize());
  bindModalClose();
  const modal = $('#diagram-font-size-modal');
  const cancelButton = $('#diagram-font-size-cancel');
  const applyButton = $('#diagram-font-size-apply');
  modal?.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    closeModal();
  });
  applyButton?.addEventListener('click', () => {
    const value = modal?.querySelector('input[name="diagram-font-size"]:checked')?.value;
    const selectedSize = saveDiagramFontSize(value);
    closeModal();
    showToast(`Estilo de letra: ${DIAGRAM_FONT_SIZES[selectedSize].label}`);
  });
  cancelButton?.focus();
}

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
      return;
    }
    if (action === 'diagram-font-size') {
      openDiagramFontSizeModal();
    }
  });
}
