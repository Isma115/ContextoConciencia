# NexusData

NexusData es una aplicación de escritorio Electron para centralizar documentación, configuraciones y notas técnicas en una base de datos SQLite local. Esta versión funciona únicamente en modo offline y no requiere cuentas, MySQL ni servicios externos.

## Requisitos

- Node.js 22.5 o superior (usa `node:sqlite`).
- pnpm y Docker Compose.

## Puesta en marcha

```bash
pnpm install
npm run dev
```

La aplicación entra directamente en modo offline. Los archivos y carpetas se leen desde el equipo y la información se guarda en la base de datos local de la aplicación.

Las funciones de cuentas, autenticación online y fuentes REST quedan reservadas para una versión posterior.

También se puede levantar solo el servidor local interno para desarrollo:

```bash
pnpm server
```

El servidor que usa Electron es interno y solo sirve la interfaz y la persistencia local; no habilita conexiones a servicios remotos.

## Integraciones online

Las integraciones REST, MySQL y el servidor HTTP de prueba se conservan en el código para una futura activación, pero no se usan en esta versión offline.

Las rutas de API local siguen siendo un detalle interno de la aplicación y no deben configurarse contra servidores externos.

## Funcionalidades

- Importación de archivos y carpetas JSON, CSV, TXT, Markdown, diagramas NexusData `.nxd`, HTML, CSS y JavaScript.
- La sincronización local indexa únicamente rutas y metadatos ligeros; el contenido se lee al abrir cada documento.
- Visor HTML para previsualizar proyectos locales con sus hojas de estilo y scripts enlazados.
- Fuentes locales persistentes: carga varias carpetas o ficheros y consúltalos de forma conjunta desde Buscar.
- Buscar unifica consulta, filtros y resultados de fuentes locales.
- El checkbox **Rutas comunes** permite ampliar temporalmente la búsqueda a las carpetas habituales del directorio personal: Documentos, Descargas, Imágenes, Escritorio, Películas/Vídeos, Música, Público, Proyectos y Código. Solo se incluyen las carpetas que existen y la opción permanece desactivada por defecto.
- La aplicación arranca en Buscar; las fuentes se cargan desde la misma vista y pueden seleccionarse individualmente en Mapa de código.
- Mapa de código generado desde una fuente local, el proyecto completo, un fichero de entrada o una carpeta seleccionada, con compatibilidad para JavaScript/TypeScript, Python, Java, C/C++, C#, Go, Rust, PHP, Ruby, Kotlin, Swift, Dart, Lua, R, Scala, Perl, Shell, PowerShell y SQL.
- Sincronización manual con altas y actualizaciones por identificador.
- Exportación e importación del espacio de trabajo en JSON, con fuentes, documentos, etiquetas, colecciones, favoritos, diagramas y preferencias. Las rutas locales se conservan, pero no se copian los archivos externos.
- Búsqueda exacta, parcial y aproximada con Fuse.js.
- Filtros por fuente, tipo, etiqueta, colección y fecha.
- Etiquetas, colecciones y origen visible de cada documento.
- Electron con `nodeIntegration: false` y `contextIsolation: true`.

## API principal

Las rutas están documentadas en `GOAL.md`. Además, se incluyen `GET /api/health`, `GET /api/stats` y las rutas auxiliares de etiquetas necesarias para organizar documentos desde la interfaz.
# ContextoConciencia
