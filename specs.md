# Specs

## Arranque de la aplicación de escritorio

- Estado: Implementada
- Categoría: Plataforma

El paquete inicia Electron desde `desktop/main.js` mediante los scripts `dev` y `start`. La ventana se crea con un tamaño inicial de 1400 × 900, un mínimo de 1120 × 720, aislamiento de contexto, `nodeIntegration` desactivado y sandbox habilitado. Al arrancar se inicia el servidor local interno, se abre la base SQLite de `userData/nexusdata.db` y se muestra la vista Buscar.

## Servidor HTTP local y API

- Estado: Implementada
- Categoría: Backend

El script `server` inicia Express en `127.0.0.1` y en el puerto `PORT` o 3000. `GET /api/health` es público; las rutas de negocio bajo `/api` requieren una sesión válida, mientras que las rutas de autenticación aplican sus propias validaciones. El servidor sirve la interfaz de escritorio, acepta cuerpos JSON de hasta 30 MB y devuelve respuestas JSON para rutas inexistentes y errores internos.

## Modo offline y sesión de la aplicación

- Estado: Implementada
- Categoría: Seguridad

El modo offline está activado por defecto y Electron fuerza `OFFLINE_ONLY=true`. La aplicación crea una sesión JWT offline en la cookie HttpOnly `nexusdata_session`, con usuario visible `Modo offline`, duración predeterminada de ocho horas, `SameSite=Strict` y `Secure` únicamente en producción. En este modo las fuentes REST y las operaciones de autenticación online se rechazan, y las consultas de fuentes, documentos, etiquetas y colecciones se limitan a datos locales.

## Autenticación online y fuentes REST configurables

- Estado: Implementada
- Categoría: Integración condicional

Cuando el servidor se inicia con `OFFLINE_ONLY=false`, crea la tabla de usuarios en MySQL y habilita registro, inicio de sesión, consulta de sesión y cierre de sesión. Las contraseñas se validan y almacenan con `bcrypt`, el registro y el inicio de sesión tienen un límite de 10 solicitudes por 15 minutos y la cookie conserva las mismas propiedades de sesión. En esa configuración se pueden crear fuentes REST HTTP o HTTPS con cabeceras y selectores de mapeo; la sincronización acepta listas o respuestas JSON con `data`, `results`, `items` o `issues`.

## Fuentes locales y sincronización

- Estado: Implementada
- Categoría: Fuentes de datos

La API permite listar, crear, editar, probar, sincronizar y eliminar fuentes locales. Una fuente local contiene una o más rutas de archivos o carpetas, admite hasta 50 entradas y pasa por los estados `pending`, `syncing`, `ready` o `error`. La sincronización registra la fecha del último éxito y el último error, actualiza documentos por la combinación de fuente e identificador externo y elimina en cascada sus documentos al borrar la fuente. En modo offline las respuestas solo exponen fuentes locales y las cabeceras sensibles de las fuentes se enmascaran.

## Proyecto global para análisis de código

- Estado: Implementada
- Categoría: Organización de fuentes

`POST /api/global-project` valida que la ruta exista y sea una carpeta, crea o actualiza una fuente local con el rol `global-project` y sincroniza su contenido. `GET /api/global-project` devuelve el proyecto cargado y `DELETE /api/global-project` lo elimina con sus documentos. La fuente global se utiliza como valor predeterminado del mapa de código cuando no se indica otra fuente.

## Importación e indexación de archivos locales

- Estado: Implementada
- Categoría: Persistencia

El importador recorre carpetas de forma recursiva y reconoce JSON, CSV, texto, Markdown, HTML, CSS, JavaScript, diagramas `.nxd`, imágenes, vídeos y audios. Limita cada archivo de texto a 10 MB, una sincronización a 2000 archivos, las imágenes a 25 MB y los vídeos o audios a 200 MB. JSON y CSV reciben metadatos específicos; las imágenes, vídeos y audios conservan metadatos y se sirven por streaming. Los archivos de texto grandes pueden quedar indexados con contenido diferido y se hidratan al abrirlos si la ruta sigue siendo válida. Se omiten nombres ocultos, enlaces simbólicos y carpetas excluidas según la configuración de la fuente.

## Rutas comunes del equipo

- Estado: Implementada
- Categoría: Fuentes locales

`GET /api/common-paths` detecta carpetas existentes como Documentos, Descargas, Escritorio, Imágenes, Vídeos, Música, Público, Proyectos y Código, respetando las variantes de nombre del sistema. `POST /api/common-paths/sync` las indexa en una fuente con rol `common-paths`; excluye directorios como `.git`, `.vscode`, `node_modules`, `dist`, `build`, `coverage` y `__pycache__`. La búsqueda excluye esta fuente por defecto y la interfaz ofrece una casilla para incluirla.

## Búsqueda unificada de documentos

- Estado: Implementada
- Categoría: Consulta

`GET /api/search` realiza búsquedas vacías o textuales sobre documentos locales mediante Fuse.js y un trabajador separado de lectura SQLite. Filtra por fuente, tipo, etiqueta, colección, favorito y fecha de actualización; permite incluir las rutas comunes. La búsqueda textual pondera título, contenido, ruta, tipo, etiquetas y metadatos, devuelve hasta 100 resultados con puntuación, fragmento y resaltado, y mantiene orden estable. En recursos multimedia la búsqueda se limita al título indexado.

## Consulta, edición y apertura de documentos

- Estado: Implementada
- Categoría: Documentos

La API y la interfaz muestran documentos recientes, favoritos, resultados de búsqueda y documentos por identificador. Abrir un documento actualiza `last_opened_at`; se puede editar el título y el contenido, marcar o desmarcar como favorito, copiar la ruta, revelar un archivo local y añadir etiquetas o colecciones. El título tiene un máximo de 240 caracteres y el contenido editable de 1.500.000 caracteres. Las imágenes, vídeos y audios se entregan desde la ruta local validada, con soporte de rangos HTTP y respuesta 206 parcial.

## Etiquetas y colecciones

- Estado: Implementada
- Categoría: Organización

Las etiquetas tienen nombres únicos sin distinguir mayúsculas y se pueden asociar o desasociar de documentos. Las colecciones admiten nombre, descripción y relaciones con documentos; el nombre admite hasta 120 caracteres y la descripción hasta 500. La API permite crear, consultar, añadir elementos, eliminar elementos y eliminar colecciones, manteniendo las eliminaciones en cascada definidas por la base de datos.

## Exportación e importación del espacio de trabajo

- Estado: Implementada
- Categoría: Persistencia

`GET /api/workspace/export` genera un espacio de trabajo con fuentes locales, documentos, etiquetas, colecciones y estado de cliente. `POST /api/workspace/import` acepta el formato de espacio de trabajo versión 1 en modo `merge` o `replace`, valida los datos y conserva las rutas; no copia los archivos externos. La interfaz permite seleccionar y guardar archivos JSON de hasta 50 MB y usa permisos de archivo restringidos al guardar.

## Visor HTML local

- Estado: Implementada
- Categoría: Visualización

El visor inspecciona hasta 50 rutas y hasta 2000 archivos, con un máximo de 10 MB por archivo y 20 MB por proyecto. Selecciona `index.html` como entrada cuando existe, inserta CSS local y scripts locales en el documento, elimina referencias externas o inexistentes y muestra el resultado en un `iframe` con sandbox. Las previsualizaciones generadas por la API usan un token temporal de 10 minutos, una política CSP restrictiva y un máximo de 30 MB para el HTML resultante.

## Diagramas visuales y diagramas por texto

- Estado: Implementada
- Categoría: Diagramas

El editor visual guarda diagramas en `localStorage`, los vincula opcionalmente a una fuente y ofrece nodos de inicio, paso, decisión y fin, conexiones etiquetadas, selección, edición, redimensionado, zoom, cuadrícula, deshacer y rehacer. Importa y exporta `.nxd` y JSON, y exporta PNG. El lenguaje textual reconoce la declaración `diagram`, nodos, descripciones y conexiones con dirección; valida identificadores, duplicados, nodos inexistentes y errores con línea y columna antes de serializar el modelo canónico.

## Mapa estático de código

- Estado: Implementada
- Categoría: Análisis

El mapa de código enumera archivos de fuentes locales y analiza un proyecto, un archivo de entrada o una carpeta. Soporta JavaScript, TypeScript, HTML, CSS y otros lenguajes de programación configurados, resuelve imports mediante `tsconfig`, `jsconfig` y `package.json`, y representa relaciones como imports, requires, referencias de scripts y estilos, exports, llamadas y herencia. Aplica límites de archivos, tamaño, profundidad y exclusiones, informa advertencias y dependencias no resueltas, y no ejecuta el código analizado. El análisis puede ejecutarse de forma síncrona o mediante trabajos consultables y cancelables.

## Explorador de ficheros local

- Estado: Implementada
- Categoría: Sistema de archivos

El explorador obtiene raíces locales permitidas, lista carpetas y archivos, busca por nombre, abre archivos mediante el sistema, conserva historial y permite ordenar y cambiar la vista. Las operaciones de crear carpeta, renombrar, eliminar y transferir comprueban que las rutas estén dentro de una raíz permitida, impiden copiar una carpeta sobre sí misma y generan nombres alternativos cuando el destino ya existe.

## Editor S.D.D. basado en Markdown

- Estado: Implementada
- Categoría: Especificación

El módulo S.D.D. carga una carpeta que contiene `specs.md` y `specs_resources`, recarga los cambios del disco e inyecta una carpeta seleccionada. El servidor interpreta las cuatro secciones Markdown `Specs`, `BBDD`, `UI` y `Recursos`; la interfaz permite crear, editar y eliminar requisitos, tablas, columnas y referencias. En cada sección se puede buscar, filtrar y ordenar; los requisitos admiten selección y edición masiva, duplicado y reordenación mediante arrastrar/soltar. Las modificaciones se escriben directamente en `specs.md` en Markdown legible, sin tablas S.D.D. adicionales en la base de datos principal. El botón `Informe` genera un informe HTML, una matriz CSV y una vista preparada para imprimir o guardar como PDF.

## Recursos multimedia y referencias S.D.D.

- Estado: Implementada
- Categoría: Especificación

El módulo S.D.D. enumera recursivamente los archivos reales de `specs_resources` sin cargar su contenido completo en memoria. Permite subir varios archivos o carpetas mediante selector y arrastrar/soltar, crear carpetas, navegar por breadcrumbs, buscar, filtrar por tipo, descargar, abrir externamente, renombrar y eliminar. Las rutas se normalizan dentro de `specs_resources`, se rechazan los recorridos fuera de esa carpeta y el renombrado actualiza las referencias de `specs.md`. El borrado comprueba referencias UI/Markdown y exige confirmación explícita antes de dejar referencias pendientes.

Las previsualizaciones de imagen, vídeo y audio se sirven con URLs HTTP bajo demanda, `loading="lazy"` y streaming con rangos. La detección de tipo prioriza la firma del contenido sobre la extensión; los audios que Chromium no pueda reproducir disponen de conversión bajo demanda a MP3 mediante FFmpeg y de apertura con la aplicación predeterminada del sistema.

## Seguridad de la interfaz y de las rutas

- Estado: Implementada
- Categoría: Seguridad

La ventana usa una política CSP que restringe scripts, imágenes, medios y marcos, y el `preload` expone únicamente métodos definidos mediante `contextBridge`. Las rutas de documentos, proyectos, archivos del mapa de código y recursos S.D.D. se comprueban contra sus raíces autorizadas; los archivos binarios y los recursos HTML se validan por tipo y tamaño. El análisis de código es estático y el contenido HTML se muestra dentro de un marco sandbox.

## Preferencias, menús y cierre seguro

- Estado: Implementada
- Categoría: Experiencia de escritorio

Los menús nativos permiten cambiar paleta, contraste de líneas y tamaño de fuente, exportar o importar el espacio de trabajo y acceder a las operaciones de diagramas, visor HTML y S.D.D. Las preferencias de tema, búsqueda y diagramas se guardan localmente. Al cerrar la ventana el renderer solicita confirmación y la aplicación solo termina cuando el usuario confirma.

## Renderizado de Markdown y formatos documentales

- Estado: Implementada
- Categoría: Presentación

El renderer muestra y edita Markdown, JSON, CSV, texto, HTML, CSS, JavaScript y diagramas según su tipo. El Markdown admite encabezados, énfasis, listas, citas, enlaces, código, tablas y separadores; los enlaces se filtran por protocolo antes de renderizarse. El editor ofrece vista previa, edición, copia y guardado, y muestra un estado de error para respuestas API no válidas o tipos no soportados.

## Prompts copiables desde el menú

- Estado: Implementada
- Categoría: Integración de escritorio

El menú incluye acciones para generar un prompt de diagrama nuevo, un prompt de diff de Git, un prompt de especificaciones completadas y un prompt para trabajar siguiendo `specs.md` y los recursos de `specs_resources`. Cada acción construye el texto con el estado disponible de la aplicación, lo copia al portapapeles y muestra una notificación de resultado o error.

## Manejo de errores y estados de sincronización

- Estado: Implementada
- Categoría: Operación

Las rutas validan identificadores, tamaños, tipos, límites y existencia de rutas antes de operar. Los errores de validación se devuelven con estado 400, los recursos ausentes con 404, las operaciones no permitidas con 403, los conflictos de nombres con 409 y los fallos de sincronización o integración con 502 cuando corresponde. Las fuentes conservan `last_error` y estado `error`; la interfaz presenta errores mediante modales, estados vacíos y notificaciones.

# BBDD

## sources

Almacena las fuentes locales o REST y el estado de sus sincronizaciones.

| Columna | Tipo | Nulo | Clave | Predeterminado | Descripción |
| ------- | ---- | ---- | ----- | -------------- | ----------- |
| id | TEXT | No | PK | — | Identificador único de la fuente. |
| name | TEXT | No | — | — | Nombre visible de la fuente. |
| type | TEXT | No | — | — | Tipo de fuente; la restricción permite `local` o `rest`. |
| config_json | TEXT | No | — | '{}' | Configuración serializada de la fuente. |
| status | TEXT | No | — | 'pending' | Estado de sincronización. |
| created_at | TEXT | No | — | — | Fecha de creación. |
| last_sync_at | TEXT | Sí | — | — | Fecha de la última sincronización correcta. |
| last_error | TEXT | Sí | — | — | Último error de sincronización. |

## documents

Almacena el índice y el contenido disponible de cada documento asociado a una fuente.

| Columna | Tipo | Nulo | Clave | Predeterminado | Descripción |
| ------- | ---- | ---- | ----- | -------------- | ----------- |
| id | TEXT | No | PK | — | Identificador único del documento. |
| source_id | TEXT | No | — | — | Referencia a `sources.id`, con eliminación en cascada. |
| external_id | TEXT | No | — | — | Identificador del documento dentro de la fuente. |
| title | TEXT | No | — | — | Título mostrado. |
| content | TEXT | No | — | '' | Contenido disponible o vacío cuando se difiere su carga. |
| type | TEXT | No | — | — | Tipo normalizado del documento. |
| path | TEXT | Sí | — | — | Ruta local o URL externa. |
| metadata_json | TEXT | No | — | '{}' | Metadatos serializados. |
| is_favorite | INTEGER | No | — | 0 | Indicador entero de favorito, 0 o 1. |
| created_at | TEXT | No | — | — | Fecha de creación. |
| updated_at | TEXT | No | — | — | Fecha de última actualización. |
| last_opened_at | TEXT | Sí | — | — | Fecha de última apertura. |

## tags

Define etiquetas reutilizables con nombre único sin distinguir mayúsculas y minúsculas.

| Columna | Tipo | Nulo | Clave | Predeterminado | Descripción |
| ------- | ---- | ---- | ----- | -------------- | ----------- |
| id | TEXT | No | PK | — | Identificador único de la etiqueta. |
| name | TEXT | No | — | — | Nombre único de la etiqueta. |

## document_tags

Relaciona documentos y etiquetas mediante una clave primaria compuesta y eliminaciones en cascada.

| Columna | Tipo | Nulo | Clave | Predeterminado | Descripción |
| ------- | ---- | ---- | ----- | -------------- | ----------- |
| document_id | TEXT | No | PK | — | Referencia a `documents.id`. |
| tag_id | TEXT | No | PK | — | Referencia a `tags.id`. |

## collections

Almacena colecciones de documentos.

| Columna | Tipo | Nulo | Clave | Predeterminado | Descripción |
| ------- | ---- | ---- | ----- | -------------- | ----------- |
| id | TEXT | No | PK | — | Identificador único de la colección. |
| name | TEXT | No | — | — | Nombre único de la colección. |
| description | TEXT | No | — | '' | Descripción de la colección. |
| created_at | TEXT | No | — | — | Fecha de creación. |

## collection_items

Relaciona colecciones y documentos mediante una clave primaria compuesta y eliminaciones en cascada.

| Columna | Tipo | Nulo | Clave | Predeterminado | Descripción |
| ------- | ---- | ---- | ----- | -------------- | ----------- |
| collection_id | TEXT | No | PK | — | Referencia a `collections.id`. |
| document_id | TEXT | No | PK | — | Referencia a `documents.id`. |

## usuarios

Tabla MySQL creada únicamente cuando el servidor se ejecuta con `OFFLINE_ONLY=false`; no forma parte de la base SQLite usada por Electron en modo offline.

| Columna | Tipo | Nulo | Clave | Predeterminado | Descripción |
| ------- | ---- | ---- | ----- | -------------- | ----------- |
| id | BIGINT UNSIGNED | No | PK | AUTO_INCREMENT | Identificador numérico del usuario. |
| usuario | VARCHAR(50) | No | — | — | Nombre de usuario único. |
| password_hash | VARCHAR(255) | No | — | — | Hash de la contraseña. |
| creado_en | TIMESTAMP | No | — | CURRENT_TIMESTAMP | Fecha de creación. |
| actualizado_en | TIMESTAMP | No | — | CURRENT_TIMESTAMP | Fecha de actualización automática mediante `ON UPDATE CURRENT_TIMESTAMP`. |

# UI

## Buscar

- Tipo: Texto
- Descripción: Vista inicial para consultar el índice documental.

Incluye búsqueda global y por fuente, filtros de tipo, etiqueta, colección y fecha, opción para incluir rutas comunes, resultados con fragmentos resaltados, acceso al documento, favoritos, etiquetas, colecciones, copia de ruta y revelado del archivo local.

## Documentos recientes

- Tipo: Texto
- Descripción: Vista de documentos ordenados por última apertura.

Solicita hasta 15 documentos mediante `/api/documents/recent` y muestra sus tarjetas con acciones de apertura, favorito, copia de ruta, revelado y organización.

## Favoritos

- Tipo: Texto
- Descripción: Vista de documentos marcados como favoritos.

Solicita hasta 500 documentos mediante `/api/documents/favorites` y define una búsqueda local por título, ruta, contenido, tipo y etiqueta. En la implementación actual el filtrado referencia la variable `visible` sin definir después de cargar la respuesta, por lo que la renderización de esta vista puede terminar en el estado de error de la interfaz.

## Visor HTML

- Tipo: Texto
- Descripción: Vista para previsualizar proyectos HTML locales.

Permite abrir carpetas o archivos desde el menú nativo, conserva hasta ocho proyectos recientes, cambia entre previsualización y código, muestra el HTML aislado en un iframe y permite cerrar el proyecto actual.

## Diagramas

- Tipo: Texto
- Descripción: Editor visual de diagramas asociados opcionalmente a una fuente.

Presenta un lienzo con zoom, cuadrícula, nodos y conexiones; permite seleccionar, editar, conectar, redimensionar, deshacer, rehacer, importar, exportar, duplicar y eliminar diagramas.

## Mapa de código

- Tipo: Texto
- Descripción: Vista del grafo estático y del árbol de un proyecto local.

Permite elegir fuente, ámbito y archivo o carpeta objetivo, ejecutar el análisis, cancelar trabajos, consultar advertencias, filtrar por lenguaje, símbolo, relación o texto y abrir el contenido de un archivo con su línea seleccionada.

## Fuentes

- Tipo: Texto
- Descripción: Administración de fuentes y sincronizaciones.

Muestra nombre, tipo, rutas o URL, estado, cantidad de documentos, última sincronización y error; ofrece probar, sincronizar, editar y eliminar. En el modo de escritorio visible solo permite crear fuentes locales.

## Explorador de ficheros

- Tipo: Texto
- Descripción: Navegador de raíces, carpetas y archivos locales.

Incluye árbol de carpetas, lista de archivos, búsqueda, historial, ordenación, cambio de vista y operaciones de creación, renombrado, eliminación y transferencia dentro de las raíces autorizadas.

## S.D.D. · Specs

- Tipo: Texto
- Descripción: Editor de requisitos del archivo `specs.md`.

Muestra los requisitos cargados, permite buscar, filtrar, ordenar, crear, editar, duplicar, eliminar y reordenar entradas. También permite seleccionar varios requisitos para cambiar su estado, categoría o descripción de una vez, y guarda los cambios mediante la sincronización Markdown del proyecto seleccionado.

## S.D.D. · Base de datos

- Tipo: Texto
- Descripción: Editor de tablas y columnas definidas en `specs.md`.

Muestra las tablas y sus columnas, permite buscar, filtrar y ordenar por nombre, número de columnas o fecha, y permite crear, editar y eliminar ambos tipos de elemento con sus validaciones de nombre, tipo, nulabilidad, clave, valor predeterminado y descripción.

## S.D.D. · UI

- Tipo: Texto
- Descripción: Editor de referencias de interfaz del proyecto S.D.D.

Permite buscar y filtrar referencias de texto, imagen, vídeo y audio, ordenarlas, editar sus metadatos y previsualizar archivos multimedia disponibles en `specs_resources`.

## S.D.D. · Recursos

- Tipo: Texto
- Descripción: Explorador de recursos multimedia y archivos de `specs_resources`.

Enumera imágenes, vídeos, audios y otros archivos encontrados, previsualiza los formatos multimedia compatibles con carga perezosa, permite gestionar carpetas y muestra advertencias antes de eliminar recursos referenciados. Incluye controles de subida múltiple y arrastrar/soltar, búsqueda, filtros, renombrado, descarga, apertura externa y revelado mediante el sistema operativo; el audio no compatible puede convertirse a MP3 con FFmpeg.

## Preferencias y menús de aplicación

- Tipo: Texto
- Descripción: Menús nativos y preferencias persistentes del escritorio.

Incluye paletas Noche azul, Océano, Bosque y Ciruela, niveles de contraste de líneas, tamaños de fuente, exportación e importación del espacio de trabajo, acciones de visor HTML, diagramas, mapa de código y S.D.D., además de la confirmación antes de cerrar.

# Recursos

No hay archivos reales disponibles dentro de `specs_resources`.
