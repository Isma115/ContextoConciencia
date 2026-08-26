# Mapa de código

La vista **Mapa de código** analiza el proyecto global cargado en NexusData sin ejecutar sus ficheros. El resultado es regenerable: el mapa no modifica el proyecto ni sustituye a los diagramas manuales.

## Alcances

- **Proyecto completo** recorre todos los ficheros compatibles dentro de la raíz autorizada.
- **Desde un fichero** sigue las relaciones locales salientes de forma transitiva. Mantiene los ficheros visitados, por lo que los ciclos no provocan recursión infinita.

Se analizan `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`, `.html`, `.htm` y `.css`. Las dependencias externas se muestran como paquetes opcionales y no se inspecciona su código.

## Relaciones

`imports` y `requires` enlazan módulos JavaScript/TypeScript; `calls` y `extends` enlazan símbolos cuando el nombre puede resolverse de forma estática. HTML aporta `references-script` y `references-style`; CSS aporta `imports-style` y referencias locales de `url(...)`. Las exportaciones aparecen como relaciones desde el fichero a sus símbolos.

Una ruta no resuelta se conserva como relación con `resolved: false` y aparece como advertencia. Un error de sintaxis o lectura de un fichero tampoco cancela el análisis del resto.

## Límites y seguridad

El límite inicial es de 2.000 ficheros y 2 MB por fichero. Se excluyen `node_modules`, `.git`, `dist`, `build`, `coverage`, cachés y artefactos equivalentes. La vista permite añadir patrones de exclusión para un análisis concreto.

Las rutas se normalizan y validan contra la raíz real del proyecto. Los enlaces simbólicos que apunten fuera de esa raíz se omiten. El backend solo obtiene la raíz desde el proyecto global guardado; el renderer no puede enviar una raíz arbitraria. El contenido se lee como texto y nunca se importa, evalúa ni ejecuta.

## API

- `GET /api/code-map/files` descubre ficheros compatibles para el selector de raíz.
- `POST /api/code-map/analyze` genera el modelo normalizado. Usa `{ "scope": "project" }` o `{ "scope": "entry", "entryFile": "src/index.ts" }`.
- `POST /api/code-map/analyze` con `{ "async": true }` devuelve un `jobId`; su progreso se consulta en `GET /api/code-map/status/:jobId` y se cancela con `DELETE /api/code-map/jobs/:jobId`.
- `GET /api/code-map/file?path=...&line=...` devuelve una fuente compatible para el visor de código, validando siempre la raíz.

El contrato está versionado con `schemaVersion: 1` y evita transportar objetos AST o el código fuente completo dentro del grafo.
