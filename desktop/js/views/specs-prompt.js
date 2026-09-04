import { showToast } from '../ui/notifications.js';

const COMPLETED_SPECS_PROMPT = `Actúa como analista técnico y trabaja sobre el código, la documentación y la configuración de mi proyecto. Analiza primero la implementación real del proyecto completo: sus puntos de entrada, funcionalidades, pantallas, APIs, persistencia, validaciones, permisos, integraciones, errores y resultados.

## Objetivo

Genera o actualiza un archivo "specs.md" en la raíz del proyecto que documente todos los requisitos verificables que ya están implementados en el código. No inventes funcionalidades, no incluyas ideas futuras y no conviertas tareas pendientes, ejemplos o documentación aspiracional en requisitos cumplidos. Cada requisito debe estar respaldado por la implementación real o por documentación que describa una funcionalidad existente.

## Formato obligatorio compatible con S.D.D

El contenido debe seguir literalmente este formato, que es el que interpreta la ventana S.D.D · Specs:

# Specs

## Título claro y específico del requisito
**Estado:** Implementada
**Categoría:** Nombre de la categoría

Descripción del comportamiento implementado, su contexto, criterios de aceptación, condiciones, validaciones, excepciones y resultado observable.

Repite un bloque como ese para cada requisito. Las reglas son:

- Conserva exactamente el encabezado inicial "# Specs".
- Usa un encabezado "##" por requisito, con un título único, descriptivo y de no más de 200 caracteres.
- Escribe exactamente "**Estado:** Implementada" en todos los requisitos. No uses Borrador, Activa, Aprobada, Pendiente ni otros estados.
- Incluye "**Categoría:** ..." cuando ayude a organizar el requisito; la categoría es opcional.
- Describe cada requisito con hechos comprobables y detalles útiles para verificarlo desde el proyecto. Puedes usar varios párrafos o listas dentro de la descripción, pero no añadas metadatos que S.D.D no reconoce.
- No uses encabezados Markdown de nivel 2, 3 o 4 dentro de una descripción, porque S.D.D los interpreta como el comienzo de otro requisito.
- Incluye todos los requisitos funcionales y técnicos ya implementados que puedan deducirse del proyecto, sin duplicarlos ni agrupar comportamientos independientes de forma ambigua.
- No incluyas prioridades, porcentajes, campos de seguimiento, casillas sin marcar, marcadores de posición ni secciones adicionales fuera de los bloques de requisitos.
- Mantén el archivo en UTF-8, termina con un salto de línea y no lo envuelvas en un bloque de código.

## Guardado y respuesta

Guarda el resultado como "specs.md" en la raíz del proyecto, reemplazando el archivo anterior si existe. Antes de guardarlo, comprueba que todos los bloques tienen título, descripción y exactamente el estado "Implementada". Después de guardarlo, responde únicamente con el contenido final de "specs.md", sin explicaciones ni texto adicional.`;

export function buildCompletedSpecsPrompt() {
  return COMPLETED_SPECS_PROMPT;
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

export async function copyCompletedSpecsPrompt() {
  try {
    await copyTextToClipboard(buildCompletedSpecsPrompt());
    showToast('Prompt de specs.md copiado al portapapeles');
  } catch (error) {
    showToast(error.message || 'No se pudo copiar el prompt de specs.md', true);
  }
}
