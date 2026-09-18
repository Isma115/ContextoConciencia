import { showToast } from '../ui/notifications.js';
import { getPromptOverride, replacePromptVariables } from '../core/prompt-store.js';

export const SDD_PROMPT_INCLUDE_FULL_KEY = 'nexusdata.sdd-prompt-include-full';
export const SDD_PROMPT_SKIP_TESTS_KEY = 'nexusdata.sdd-prompt-skip-tests';

export function readStoredSddPromptIncludeFull() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(SDD_PROMPT_INCLUDE_FULL_KEY) === 'true';
    }
  } catch {
    // El almacenamiento local puede no estar disponible.
  }
  return false;
}

export function readSddPromptIncludeFull() {
  try {
    const checkbox = typeof document !== 'undefined' ? document.querySelector('#sdd-include-full-prompt') : null;
    if (checkbox instanceof HTMLInputElement) return checkbox.checked === true;
  } catch {
    // Sin acceso al DOM: se usa el valor almacenado.
  }
  return readStoredSddPromptIncludeFull();
}

export function persistSddPromptIncludeFull(includeFull) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(SDD_PROMPT_INCLUDE_FULL_KEY, String(includeFull === true));
    }
  } catch {
    // La preferencia del prompt sigue funcionando aunque no se pueda persistir.
  }
  return includeFull === true;
}

export function readStoredSddPromptSkipTests() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage.getItem(SDD_PROMPT_SKIP_TESTS_KEY) === 'true';
    }
  } catch {
    // El almacenamiento local puede no estar disponible.
  }
  return false;
}

export function readSddPromptSkipTests() {
  try {
    const checkbox = typeof document !== 'undefined' ? document.querySelector('#sdd-skip-tests-prompt') : null;
    if (checkbox instanceof HTMLInputElement) return checkbox.checked === true;
  } catch {
    // Sin acceso al DOM: se usa el valor almacenado.
  }
  return readStoredSddPromptSkipTests();
}

export function persistSddPromptSkipTests(skipTests) {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(SDD_PROMPT_SKIP_TESTS_KEY, String(skipTests === true));
    }
  } catch {
    // La preferencia del prompt sigue funcionando aunque no se pueda persistir.
  }
  return skipTests === true;
}

function completedSpecsPromptBody(includeFull) {
  const contextSection = includeFull
    ? `Antes de generar nada, lee la carpeta "SDD_specs" del proyecto: usa "SDD_specs/specs.md" como lista de requisitos pendientes y "SDD_specs/specs_full.md" como fuente de verdad de todos los requisitos y estados. Lee también los recursos reales de "SDD_specs/specs_resources", incluidas sus subcarpetas.`
    : `Antes de generar nada, lee únicamente "SDD_specs/specs.md" y los recursos reales de "SDD_specs/specs_resources". El primer archivo contiene solo requisitos pendientes; no uses "SDD_specs/specs_full.md" para decidir qué documentar.`;
  const saveSection = includeFull
    ? `Guarda el resultado en la carpeta "SDD_specs" respetando este modelo:

- "SDD_specs/specs_full.md" es la fuente de verdad. Parte de su contenido actual y conserva todos los requisitos, estados, categorías, descripciones e identificadores existentes. Añade solo requisitos nuevos respaldados por el código y márcalos exactamente como "- Estado: Implementada". No dupliques ni cambies silenciosamente requisitos existentes.
- Conserva las cuatro secciones Markdown de primer nivel y actualiza BBDD, UI y Recursos solo con información verificada. No conviertas tablas, referencias visuales ni archivos en requisitos de Specs.
- "SDD_specs/specs.md" debe contener los mismos bloques de BBDD, UI y Recursos y únicamente los requisitos cuyo estado no sea "Implementada". Si no quedan pendientes, conserva al menos "# Specs" y las demás secciones.

Antes de guardar, comprueba que cada requisito tiene título, descripción y estado válido, que todos los nuevos tienen estado "Implementada" y que los archivos de recursos referenciados existen. Después responde únicamente con el contenido final de "SDD_specs/specs_full.md", sin explicaciones ni texto adicional.`
    : `Guarda el resultado en la carpeta "SDD_specs" respetando este modelo:

- No modifiques "SDD_specs/specs.md": es la lista de pendientes y debe conservarse tal cual.
- Actualiza "SDD_specs/specs_full.md" sin eliminar, reordenar ni cambiar requisitos existentes. Añade al final únicamente requisitos nuevos que hayas verificado en el código, con estado exactamente "- Estado: Implementada".
- Conserva y actualiza las secciones BBDD, UI y Recursos solo con datos verificados, sin convertirlas en requisitos de Specs.

Antes de guardar, comprueba que cada requisito nuevo tiene título, descripción y estado "Implementada" y que los recursos referenciados existen. Después responde únicamente con el contenido final de "SDD_specs/specs_full.md", sin explicaciones ni texto adicional.`;
  return `Actúa como analista técnico y trabaja sobre el código, la documentación y la configuración de mi proyecto. Analiza primero la implementación real: puntos de entrada, funcionalidades, pantallas, APIs, backend, base de datos, persistencia, validaciones, permisos, integraciones, errores y resultados.

## Objetivo

Genera o actualiza documentación de requisitos y diseño que describa únicamente elementos verificables ya implementados. No inventes funcionalidades, tablas, pantallas, recursos, ideas futuras ni tareas pendientes. Cada hallazgo debe estar respaldado por el código, la configuración o documentación que describa una funcionalidad existente.

## Secciones obligatorias

Distribuye la información en cuatro secciones Markdown de primer nivel, exactamente en este orden: **Specs**, **BBDD**, **UI** y **Recursos**. No dupliques el mismo hallazgo en varias secciones.

- **Specs**: requisitos funcionales y técnicos sobre comportamientos, APIs, backend, persistencia, validaciones, seguridad, errores e integraciones.
- **BBDD**: tablas, columnas, tipos, claves, nulabilidad, valores por defecto y descripciones implementados.
- **UI**: pantallas, vistas, componentes, formularios, navegación, estados de carga/vacío/error y referencias visuales implementadas.
- **Recursos**: archivos reales disponibles en "SDD_specs/specs_resources" y su tipo.

## Comprobaciones obligatorias

Antes de redactar, comprueba en el proyecto el servidor y sus rutas, la conexión y persistencia de base de datos si existe, la interfaz completa y los recursos reales. Si una parte no existe, deja su sección con una frase breve como "No hay tablas definidas." o "No hay referencias de interfaz definidas."; no la inventes.

## Contexto de specs

${contextSection}

## Formato obligatorio compatible con S.D.D

Usa únicamente Markdown legible, sin JSON, comentarios HTML, metadatos ocultos ni bloques de código para almacenar datos. Mantén siempre estas cuatro secciones:

# Specs

## Título claro y específico del requisito
- Estado: Implementada
- Categoría: Área funcional opcional

Descripción verificable del comportamiento existente.

# BBDD

## nombre_de_tabla

Descripción breve de la tabla.

| Columna | Tipo | Nulo | Clave | Predeterminado | Descripción |
| --- | --- | --- | --- | --- | --- |
| id | INTEGER | No | PK | — | Identificador único |

# UI

## Título de la referencia
- Tipo: Texto, Imagen, Vídeo o Audio
- Archivo: specs_resources/ruta/real.ext
- Descripción: contexto de la referencia

Para una referencia de texto, escribe el contenido debajo de sus metadatos. Para imágenes, vídeos o audios, indica solo archivos reales dentro de "specs_resources".

# Recursos

- \`specs_resources/ruta/real.ext\` — Tipo

Reglas adicionales:

- Mantén las cuatro secciones aunque estén vacías.
- En Specs usa un encabezado "##" por requisito y exactamente el campo "- Estado: ..." con uno de estos valores: Activa o Implementada. La categoría es opcional; cuando la uses, elige una de estas salvo que ninguna encaje: Funcional, Usabilidad, Base de datos, Seguridad, Rendimiento, Integración.
- En BBDD usa un encabezado "##" por tabla y una tabla Markdown de columnas; usa "Sí" o "No" en Nulo, "PK" para clave primaria y "—" cuando no haya valor.
- En UI usa un encabezado "##" por referencia. No inventes rutas ni archivos.
- En Recursos enumera únicamente archivos reales. No uses encabezados Markdown de nivel 2, 3 o 4 dentro de descripciones, porque S.D.D los interpreta como nuevos elementos.
- No añadas texto fuera de las cuatro secciones.

## Guardado y respuesta

${saveSection}`;
}

const FOLLOW_SPECS_PROMPT = `Trabaja sobre el proyecto actual siguiendo "SDD_specs/specs.md" (pendientes) y "SDD_specs/specs_full.md" (requisitos y estados) como fuente de verdad.

- Implementa solo lo que describen los documentos; no inventes requisitos, diseños ni recursos.
- No modifiques el campo "- Estado: ..." de ningún requisito, ni siquiera cuando completes su implementación; conserva los estados existentes en ambos documentos.
- Ignora por completo el campo "- Color: ..." de cada Spec: es un metadato exclusivamente visual de su tarjeta. No lo trates como un requisito funcional.
- Respeta la implementación, la arquitectura y las convenciones existentes.
- Si algo es ambiguo o falta, resuélvelo de forma conservadora y déjalo constatado.`;

export function getDefaultCompletedSpecsPrompt(options = {}) {
  const includeFull = typeof options?.includeFull === 'boolean'
    ? options.includeFull
    : readSddPromptIncludeFull();
  return completedSpecsPromptBody(includeFull === true);
}

export function buildCompletedSpecsPrompt(options = {}) {
  const includeFull = typeof options?.includeFull === 'boolean'
    ? options.includeFull
    : readSddPromptIncludeFull();
  const custom = getPromptOverride('completed-specs');
  return custom || getDefaultCompletedSpecsPrompt({ includeFull });
}

export function getDefaultFollowSpecsPrompt(options = {}) {
  const skipTests = typeof options?.skipTests === 'boolean'
    ? options.skipTests
    : readSddPromptSkipTests();
  return skipTests
    ? `${FOLLOW_SPECS_PROMPT}\n- No realices pruebas sobre los cambios aplicados ni ejecutes tests.`
    : FOLLOW_SPECS_PROMPT;
}

export function buildFollowSpecsPrompt(options = {}) {
  const skipTests = typeof options?.skipTests === 'boolean'
    ? options.skipTests
    : readSddPromptSkipTests();
  const custom = getPromptOverride('follow-specs');
  return custom
    ? replacePromptVariables(custom, {
      SIN_TESTS: skipTests ? '- No realices pruebas sobre los cambios aplicados ni ejecutes tests.' : ''
    })
    : getDefaultFollowSpecsPrompt({ skipTests });
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
    const includeFull = readSddPromptIncludeFull();
    await copyTextToClipboard(buildCompletedSpecsPrompt({ includeFull }));
    showToast(includeFull
      ? 'Prompt de specs.md copiado al portapapeles (contexto: specs.md y specs_full.md)'
      : 'Prompt de specs.md copiado al portapapeles (contexto: solo pendientes)');
  } catch (error) {
    showToast(error.message || 'No se pudo copiar el prompt de specs.md', true);
  }
}

export async function copyFollowSpecsPrompt() {
  try {
    await copyTextToClipboard(buildFollowSpecsPrompt());
    showToast('Prompt para trabajar siguiendo specs copiado al portapapeles');
  } catch (error) {
    showToast(error.message || 'No se pudo copiar el prompt para trabajar siguiendo specs', true);
  }
}
