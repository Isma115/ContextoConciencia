import { $ } from '../core/dom.js';
import { showToast } from '../ui/notifications.js';
import { closeModal, bindModalClose } from '../ui/modals.js';

const DIAGRAM_PROMPT_TEMPLATE = `Analiza dentro de mi proyecto la parte de [PARTE]. Genera un HTML autocontenido (Tailwind CDN, dark theme) con diagrama interactivo de arquitectura + sección de Flows interactivos (selecciona y resalta path + pasos).\n\nY un JSON {nodes, edges, flows: [{steps}]} para agentes IA.\n\nPanel lateral derecho con todos los flujos\n\nEl resto de la pantalla dedicado solamente al diagrama completo\n\nSin textos ni títulos extra, aprovechando al máximo el tamaño de la ventana\n\nEntrega ambos completos.`;

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const helper = document.createElement('textarea');
  helper.value = text;
  helper.setAttribute('readonly', '');
  helper.style.position = 'fixed';
  helper.style.opacity = '0';
  document.body.appendChild(helper);
  helper.select();
  const copied = document.execCommand('copy');
  helper.remove();
  if (!copied) throw new Error('El portapapeles no está disponible');
}

export function openNewDiagramPromptModal() {
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="new-diagram-prompt-title"><div class="modal-head"><div><h2 id="new-diagram-prompt-title">Nuevo diagrama prompt</h2><p>Indica qué parte del proyecto quieres documentar.</p></div><button class="modal-close" data-close-modal aria-label="Cerrar">×</button></div><form id="new-diagram-prompt-form"><div class="modal-body"><label class="form-label">Parte del proyecto<input id="diagram-prompt-part" class="field" placeholder="Ej. autenticación, API de usuarios o flujo de pagos" autocomplete="off" required /></label></div><div class="modal-actions"><button class="btn btn-secondary" type="button" data-close-modal>Cancelar</button><button id="copy-diagram-prompt" class="btn btn-primary" type="submit">Copiar prompt</button></div></form></div></div>`;
  bindModalClose();
  const input = $('#diagram-prompt-part');
  input.focus();
  $('#new-diagram-prompt-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const part = input.value.trim();
    if (!part) {
      showToast('Indica qué parte del proyecto quieres documentar', true);
      input.focus();
      return;
    }
    const button = $('#copy-diagram-prompt');
    button.disabled = true;
    button.textContent = 'Copiando…';
    try {
      await copyTextToClipboard(DIAGRAM_PROMPT_TEMPLATE.replace('[PARTE]', part));
      closeModal();
      showToast('Prompt copiado al portapapeles');
    } catch (error) {
      showToast(error.message || 'No se pudo copiar el prompt', true);
    } finally {
      button.disabled = false;
      button.textContent = 'Copiar prompt';
    }
  });
}
