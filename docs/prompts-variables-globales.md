# Variables globales en los prompts

Los prompts de NexusData (los del programa y los que crea el usuario en **Configurar prompts**) pueden usar variables globales de la aplicación. Una variable se escribe como un token entre corchetes, por ejemplo `[version_specs_actual]`, y el programa lo sustituye por el valor real en el momento de copiar el prompt.

Ejemplo: en el prompt **Trabajar siguiendo specs** el contenido incluye

```
- La versión de specs que se está editando ahora mismo es la [version_specs_actual]: ten en cuenta solamente el fichero "SDD_specs/specs/[version_specs_actual].md".
```

Si la versión activa en S.D.D. es `1.2.0`, el prompt que se copia al portapapeles dice:

```
- La versión de specs que se está editando ahora mismo es la 1.2.0: ten en cuenta solamente el fichero "SDD_specs/specs/1.2.0.md".
```

## Reglas de los tokens

- El nombre solo puede contener letras, números y guion bajo: `[A-Za-z0-9_]+`.
- No distingue mayúsculas: `[version_specs_actual]` y `[VERSION_SPECS_ACTUAL]` valen igual.
- Los tokens propios del prompt tienen prioridad: `[FUNCIONALIDAD]` sigue siendo el hueco que rellena el usuario al crear un diagrama.
- Un token que no es una variable global ni una variable del prompt se conserva tal cual.
- Una variable global sin valor (por ejemplo la versión de specs cuando no hay proyecto S.D.D. cargado) se sustituye por vacío. La interfaz lo avisa con «Sin valor todavía».

## Variables disponibles

| Token | Contenido |
| --- | --- |
| `[version_specs_actual]` | Versión de specs activa en S.D.D., sin la extensión `.md` (por ejemplo `1.2.0`). |
| `[archivo_specs_actual]` | Nombre del archivo de la versión activa (`1.2.0.md`). |
| `[ruta_specs_actual]` | `SDD_specs/specs/1.2.0.md`. |
| `[carpeta_specs_versiones]` | `SDD_specs/specs`. |
| `[archivo_specs_completo]` | `SDD_specs/specs_full.md`. |
| `[archivo_bbdd]` | `SDD_specs/bbdd.md`. |
| `[carpeta_recursos_specs]` | `SDD_specs/specs_resources`. |
| `[nombre_proyecto]` | Nombre del proyecto S.D.D. cargado. |
| `[ruta_proyecto]` | Ruta absoluta del proyecto S.D.D. cargado. |

## Dónde se aplican

Todos los prompts pasan por el mismo resolutor (`desktop/js/core/prompt-store.js`), así que las variables funcionan en cualquiera de estas salidas:

- `Prompts > Trabajar siguiendo specs` (menú nativo y Configurar prompts).
- `Prompts > Generar specs.md completado`.
- `Prompts > Analizar diff de git`.
- `Prompts > Nuevo diagrama prompt` (el modal resuelve las variables globales y deja `[FUNCIONALIDAD]` para el usuario).
- Cualquier prompt personalizado, al copiarlo desde **Configurar prompts** o desde el menú **Mis prompts**.

En **Configurar prompts** cada prompt muestra el desplegable **Variables globales**: la lista de tokens con su valor actual. Al pulsar uno se inserta en el contenido, en la posición del cursor.

La vista no añade textos de ayuda: solo el desplegable de variables y la caja de texto del prompt, sin una segunda copia con el resultado resuelto.

## Código

- `desktop/js/core/prompt-variables.js`: registro de variables globales y su resolución desde el estado (`state.sddProject`).
- `desktop/js/core/prompt-store.js`: `replacePromptVariables()` resuelve primero las variables propias del prompt y después las globales.
- `desktop/js/views/specs-prompt.js`: prompt de specs y versión activa.
- `desktop/js/views/prompt-config.js`: editor y lista de variables globales insertables.
- `test/prompt-variables.test.js`: pruebas del resolutor, de la versión activa y de la copia de prompts.
