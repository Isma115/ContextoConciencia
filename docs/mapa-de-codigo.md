# Mapa de código

La vista **Mapa de código** analiza la fuente local seleccionada en NexusData sin ejecutar sus ficheros. El resultado es regenerable: el mapa no modifica la fuente ni sustituye a los diagramas manuales.

## Alcances

- **Proyecto completo** recorre todos los ficheros compatibles dentro de las rutas autorizadas de la fuente seleccionada.
- **Desde un fichero** sigue las relaciones locales salientes de forma transitiva. Mantiene los ficheros visitados, por lo que los ciclos no provocan recursión infinita.

Se analizan JavaScript y TypeScript (`.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`), Python (`.py`, `.pyw`), Java (`.java`), C# (`.cs`), C y C++ (`.c`, `.h`, `.cc`, `.cpp`, `.cxx`, `.hh`, `.hpp`, `.hxx`), Go (`.go`), Rust (`.rs`), PHP (`.php`, `.phtml`), Ruby (`.rb`, `.rake`, `.gemspec`), Kotlin (`.kt`, `.kts`), Swift (`.swift`), Dart (`.dart`), Lua (`.lua`), R (`.r`), Scala (`.scala`, `.sc`), Perl (`.pl`, `.pm`), Shell (`.sh`, `.bash`, `.zsh`, `.fish`), PowerShell (`.ps1`, `.psm1`), SQL (`.sql`), HTML (`.html`, `.htm`) y CSS (`.css`). Los lenguajes añadidos usan un analizador estático ligero para extraer símbolos e imports habituales; las dependencias externas se muestran como paquetes opcionales y no se inspecciona su código.

## Relaciones

`imports` y `requires` enlazan módulos JavaScript/TypeScript y referencias equivalentes de los lenguajes compatibles; `calls` y `extends` enlazan símbolos cuando el nombre puede resolverse de forma estática. HTML aporta `references-script` y `references-style`; CSS aporta `imports-style` y referencias locales de `url(...)`. Las exportaciones públicas o explícitas aparecen como relaciones desde el fichero a sus símbolos.

Una ruta no resuelta se conserva como relación con `resolved: false` y aparece como advertencia. Un error de sintaxis o lectura de un fichero tampoco cancela el análisis del resto.

## Límites y seguridad

El límite inicial es de 2.000 ficheros y 2 MB por fichero. Se excluyen `node_modules`, `.git`, `dist`, `build`, `coverage`, cachés y artefactos equivalentes. La vista permite añadir patrones de exclusión para un análisis concreto.

Las rutas se normalizan y validan contra la raíz real de la fuente seleccionada. Los enlaces simbólicos que apunten fuera de esa raíz se omiten y una fuente puede reunir varias rutas. El backend obtiene esas rutas de la fuente local indicada mediante `sourceId`; el renderer no puede enviar una raíz arbitraria. El contenido se lee como texto y nunca se importa, evalúa ni ejecuta.

## API

- `GET /api/code-map/files?sourceId=...` descubre ficheros compatibles de la fuente seleccionada.
- `POST /api/code-map/analyze` genera el modelo normalizado. Usa `{ "sourceId": "...", "scope": "project" }` o `{ "sourceId": "...", "scope": "entry", "entryFile": "src/index.ts" }`.
- `POST /api/code-map/analyze` con `{ "async": true }` devuelve un `jobId`; su progreso se consulta en `GET /api/code-map/status/:jobId` y se cancela con `DELETE /api/code-map/jobs/:jobId`.
- `GET /api/code-map/file?sourceId=...&path=...&line=...` devuelve una fuente compatible para el visor de código, validando siempre las rutas de la fuente.

El contrato está versionado con `schemaVersion: 1` y evita transportar objetos AST o el código fuente completo dentro del grafo.
