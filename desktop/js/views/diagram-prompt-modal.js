import { $ } from '../core/dom.js';
import { showToast } from '../ui/notifications.js';
import { closeModal, bindModalClose } from '../ui/modals.js';

const DIAGRAM_CODE_INSTRUCTIONS = `NexusData crea diagramas con un lenguaje de texto propio que se puede pegar en Diagramas > Código y ejecutar con “Generar diagrama”. El archivo es texto plano .nxd.

Sintaxis disponible:

diagram "Título del diagrama"
node identificador "Etiqueta visible" tipo at x, y
edge origen -> destino "Etiqueta opcional" dirección

Reglas del lenguaje:
- Usa una sola declaración diagram y escribe el título entre comillas.
- Declara todos los node antes de declarar los edge.
- Cada identificador de nodo debe ser único, no tener espacios y empezar por una letra o guion bajo. Solo puede contener letras, números, guiones y guiones bajos.
- La etiqueta de cada node siempre va entre comillas.
- Los tipos de nodo disponibles son start/inicio, step/paso, decision/decisión y end/fin.
- Las conexiones usan -> y solo pueden apuntar a nodos declarados.
- Las direcciones son forward/directo, backward/reverse/reversa y none/simple. Usa forward salvo que el flujo necesite otro sentido o una línea sin flecha.
- La etiqueta de un edge es opcional y debe ir entre comillas; también puede escribirse después de dos puntos.
- at x, y es opcional. Cuando se use, coloca x entre 20 y 1190 e y entre 20 y 792 para mantener las tarjetas dentro del lienzo de 1400 × 900.
- Las líneas vacías y los comentarios que comienzan por # o // se ignoran.
- No añadas instrucciones distintas de diagram, node, edge o connect.

Ejemplo válido:

diagram "Registro de usuario"
node formulario "Completar formulario" start at 100, 300
node validar "Validar datos" decision at 380, 300
node guardar "Guardar usuario" step at 680, 180
node error "Mostrar errores" step at 680, 430
node fin "Cuenta creada" end at 980, 180
edge formulario -> validar "Enviar" forward
edge validar -> guardar "Correctos" forward
edge validar -> error "Incorrectos" forward
edge guardar -> fin "Confirmar" forward
edge error -> formulario "Corregir" backward`;

const DIAGRAM_PROMPT_TEMPLATE = `Actúa como analista técnico y trabaja sobre el código, la documentación y la configuración de mi proyecto. Analiza primero la implementación real de la funcionalidad y sus puntos de entrada, dependencias, validaciones, decisiones, errores y resultados.

## Funcionalidad que debes representar

[FUNCIONALIDAD]

## Objetivo

Genera un diagrama de flujo fiel a esa funcionalidad del proyecto. Incluye el inicio, el recorrido principal, las decisiones y sus ramas, las validaciones, los errores o reintentos relevantes, las llamadas a servicios externos o bases de datos y los finales posibles. No inventes pasos que contradigan el código; si una decisión es necesaria por falta de información, indícalo como comentario del diagrama con #.

## Instrucciones para crear el diagrama con código en NexusData

${DIAGRAM_CODE_INSTRUCTIONS}

## Requisitos de modelado

- Usa nombres de nodo estables, descriptivos y fáciles de relacionar con el código.
- Usa start para el punto de entrada, decision para preguntas o bifurcaciones y end para cada resultado final.
- Etiqueta las ramas de las decisiones, por ejemplo "Sí", "No", "Válido" o "Error".
- Coloca los nodos de izquierda a derecha o de arriba abajo, mantén separación suficiente y evita que se superpongan.
- Conecta todos los pasos relevantes y comprueba que el origen y el destino de cada edge existen.
- Mantén las etiquetas breves, pero suficientemente claras para entender el flujo sin consultar una explicación adicional.

## Guardado del diagrama

- Guarda el código final como un archivo .nxd dentro de la carpeta docs del proyecto.
- Si la carpeta docs no existe, créala antes de guardar el archivo.
- Usa un nombre descriptivo y estable para el archivo, por ejemplo docs/registro-de-usuario.nxd.
- El archivo debe contener exactamente el código textual del diagrama en UTF-8 y quedar listo para abrirlo o importarlo desde NexusData.

## Formato de respuesta obligatorio

Después de guardar el archivo, devuelve únicamente un bloque de código con el lenguaje textual de NexusData, listo para copiarlo en Diagramas > Código > Generar diagrama. No devuelvas un documento HTML, CSS, JavaScript, SVG, Mermaid o JSON. No añadas explicaciones, títulos ni texto fuera del bloque de código.`;
const GIT_DIFF_PROMPT = 'Analizar diff de git y describir con detalle los cambios';

export function buildDiagramPrompt(functionality) {
  return DIAGRAM_PROMPT_TEMPLATE.replace('[FUNCIONALIDAD]', String(functionality || '').trim());
}

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

export async function copyGitDiffPrompt() {
  try {
    await copyTextToClipboard(GIT_DIFF_PROMPT);
    showToast('Prompt copiado al portapapeles');
  } catch (error) {
    showToast(error.message || 'No se pudo copiar el prompt', true);
  }
}

export function openNewDiagramPromptModal() {
  $('#modal-root').innerHTML = `<div class="modal-backdrop"><div class="modal" role="dialog" aria-modal="true" aria-labelledby="new-diagram-prompt-title"><div class="modal-head"><div><h2 id="new-diagram-prompt-title">Nuevo diagrama prompt</h2><p>Describe la funcionalidad y copia un prompt que genere y guarde código de diagrama NexusData.</p></div><button class="modal-close" data-close-modal aria-label="Cerrar">×</button></div><form id="new-diagram-prompt-form"><div class="modal-body"><label class="form-label">Funcionalidad a representar<textarea id="diagram-prompt-part" class="textarea" rows="5" placeholder="Ej. registro de usuarios: completar formulario, validar datos, guardar la cuenta y mostrar errores" required></textarea></label><p class="diagram-code-hint">El prompt incluirá la sintaxis <code>diagram</code>, <code>node</code> y <code>edge</code>, y pedirá guardar el archivo en <code>docs</code>.</p></div><div class="modal-actions"><button class="btn btn-secondary" type="button" data-close-modal>Cancelar</button><button id="copy-diagram-prompt" class="btn btn-primary" type="submit">Copiar prompt</button></div></form></div></div>`;
  bindModalClose();
  const input = $('#diagram-prompt-part');
  input.focus();
  $('#new-diagram-prompt-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const part = input.value.trim();
    if (!part) {
      showToast('Describe la funcionalidad que quieres representar', true);
      input.focus();
      return;
    }
    const button = $('#copy-diagram-prompt');
    button.disabled = true;
    button.textContent = 'Copiando…';
    try {
      await copyTextToClipboard(buildDiagramPrompt(part));
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
