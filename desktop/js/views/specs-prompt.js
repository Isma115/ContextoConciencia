import { showToast } from '../ui/notifications.js';

const COMPLETED_SPECS_PROMPT = `Actúa como analista técnico y trabaja sobre el código, la documentación y la configuración de mi proyecto. Analiza primero la implementación real del proyecto completo: sus puntos de entrada, funcionalidades, pantallas, APIs, persistencia, validaciones, permisos, integraciones, errores y resultados.

## Objetivo

Genera o actualiza el archivo "specs.md" en la raíz del proyecto. Debe documentar solo elementos verificables que ya están implementados. No inventes funcionalidades, tablas, pantallas, recursos, ideas futuras ni tareas pendientes.

## Formato obligatorio compatible con S.D.D

El documento usa cuatro secciones Markdown de primer nivel, exactamente en este orden. No uses JSON, comentarios HTML, metadatos ocultos ni bloques de código para almacenar datos.

# Specs

## Título claro y específico del requisito
- Estado: Implementada
- Categoría: Área funcional opcional

Descripción verificable del comportamiento existente.

# BBDD

## usuarios

Descripción breve de la tabla.

| Columna | Tipo | Nulo | Clave | Predeterminado | Descripción |
| --- | --- | --- | --- | --- | --- |
| id | INTEGER | No | PK | — | Identificador único |

# UI

## Pantalla de inicio
- Tipo: Imagen
- Archivo: specs_resources/inicio.png
- Descripción: Vista inicial de la aplicación.

# Recursos

- specs_resources/inicio.png — Imagen

Reglas:

- Mantén siempre las cuatro secciones, incluso cuando no haya contenido: escribe una frase breve como "No hay tablas definidas." o "No hay referencias de interfaz definidas.".
- En Specs, usa un encabezado "##" por requisito. Escribe exactamente "- Estado: Implementada" y añade "- Categoría: ..." solo cuando aporte contexto.
- En BBDD, usa un encabezado "##" por tabla y una tabla Markdown de columnas. Usa "Sí" o "No" en Nulo, "PK" para la clave primaria y "—" si no hay valor predeterminado o descripción.
- En UI, usa un encabezado "##" por referencia. Tipo solo puede ser Texto, Imagen o Vídeo. Para imágenes y vídeos indica Archivo con una ruta dentro de specs_resources. Para una referencia de texto, escribe el contenido debajo de sus metadatos.
- En Recursos, enumera únicamente los archivos reales disponibles dentro de specs_resources.
- No uses encabezados Markdown de nivel 2, 3 o 4 dentro de descripciones, porque S.D.D los interpreta como el comienzo de otro elemento.
- No añadas texto fuera de las cuatro secciones.

## Guardado y respuesta

Guarda el resultado como "specs.md" en la raíz del proyecto, reemplazando el archivo anterior si existe. Antes de guardarlo, comprueba que todas las secciones usan Markdown legible y que cada dato está respaldado por la implementación real. Después de guardarlo, responde únicamente con el contenido final de "specs.md", sin explicaciones ni texto adicional.`;

const FOLLOW_SPECS_PROMPT = `Actúa como agente de desarrollo y trabaja directamente sobre el proyecto actual.

## Fuente de verdad obligatoria

Antes de analizar, planificar o modificar código, lee el archivo "specs.md" situado en la raíz del proyecto y recorre todos los archivos disponibles dentro de la carpeta "specs_resources", incluidas sus subcarpetas. Trata el contenido de "specs.md" como la especificación funcional y técnica del trabajo, y usa los recursos como referencias reales de diseño, contenido, comportamiento o integración.

## Forma de trabajo

- Sigue los requisitos, tablas, referencias de UI y recursos descritos en "specs.md" en el orden y con las restricciones que indique el documento.
- Comprueba la implementación existente antes de cambiarla y respeta la arquitectura, las convenciones y los contratos ya usados por el proyecto.
- Usa las imágenes, vídeos y textos de "specs_resources" cuando el documento los referencie; no los sustituyas por contenido inventado ni los elimines o sobrescribas.
- No inventes requisitos, pantallas, datos, endpoints, recursos ni decisiones de diseño que no estén respaldados por "specs.md", "specs_resources" o la implementación existente.
- Si encuentras una contradicción, un dato ambiguo o un recurso ausente, deja constancia del problema y resuélvelo con la opción más conservadora sin ocultar la discrepancia.
- Implementa el trabajo completo necesario para cumplir el documento, incluyendo validaciones, estados vacíos, errores y casos límite relevantes.
- Mantén los cambios centrados en el objetivo y evita modificar documentación o recursos de referencia salvo que el propio documento lo exija.

## Validación y respuesta

Después de implementar, revisa el diff, comprueba que el resultado sigue fielmente "specs.md" y que las referencias a "specs_resources" funcionan desde el proyecto. Ejecuta las pruebas, comprobaciones o validaciones disponibles y corrige los fallos que encuentres. Responde con un resumen breve de los cambios realizados y de las comprobaciones ejecutadas.`;

export function buildCompletedSpecsPrompt() {
  return COMPLETED_SPECS_PROMPT;
}

export function buildFollowSpecsPrompt() {
  return FOLLOW_SPECS_PROMPT;
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

export async function copyFollowSpecsPrompt() {
  try {
    await copyTextToClipboard(buildFollowSpecsPrompt());
    showToast('Prompt para trabajar con specs.md copiado al portapapeles');
  } catch (error) {
    showToast(error.message || 'No se pudo copiar el prompt para trabajar con specs.md', true);
  }
}
