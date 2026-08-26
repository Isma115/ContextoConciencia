# Plan de implementación: vista de mapa automático del código

## 1. Objetivo

Crear una nueva vista de NexusData, independiente del editor de diagramas de flujo existente, capaz de analizar automáticamente el código del proyecto global y representarlo como un grafo navegable.

La vista deberá admitir dos alcances:

1. **Proyecto completo**: analiza todos los ficheros de código compatibles situados dentro de la carpeta del proyecto global.
2. **Desde un fichero**: toma un fichero como raíz y sigue de forma transitiva sus dependencias locales hasta alcanzar todos los ficheros conectados desde él.

Cada fichero se mostrará como un nodo que pueda desplegar sus símbolos: variables, constantes, funciones, clases, métodos, propiedades, importaciones y exportaciones. Las conexiones indicarán relaciones como importación, llamada, herencia o uso.

## 2. Alcance funcional

### Primera versión

- Analizar JavaScript, TypeScript, JSX, TSX, MJS y CJS.
- Reconocer referencias estáticas básicas desde HTML y CSS para enlazar entradas, scripts, hojas de estilo e importaciones CSS.
- Trabajar únicamente con rutas contenidas en el proyecto global cargado en NexusData.
- Excluir automáticamente dependencias, artefactos generados y carpetas técnicas: `node_modules`, `.git`, `dist`, `build`, `coverage`, cachés y binarios.
- Permitir reglas adicionales de exclusión mediante patrones configurables.
- Generar el mapa completo o el subgrafo alcanzable desde un fichero.
- Detectar y representar ciclos sin entrar en recursión infinita.
- Mostrar referencias no resueltas como advertencias, sin cancelar todo el análisis.
- Navegar desde un nodo hasta el fichero y la línea del símbolo en un panel de detalle o en el visor de código existente.
- Filtrar por tipo de fichero, tipo de símbolo y tipo de relación.
- Buscar ficheros o símbolos por nombre.
- Replegar y desplegar el contenido de los nodos para controlar la densidad visual.
- Recalcular el mapa manualmente y avisar cuando el resultado esté desactualizado.

### Ampliaciones posteriores

- Analizadores para Python, Java, C#, PHP u otros lenguajes mediante adaptadores independientes.
- Seguimiento semántico más profundo de llamadas indirectas, inyección de dependencias y alias complejos.
- Vista inversa de impacto: qué ficheros y símbolos dependen de un fichero seleccionado.
- Comparación entre dos versiones del mapa.
- Exportación a SVG, PNG, JSON o un formato textual de diagrama.
- Integración con Git para resaltar cambios recientes.

## 3. Definición de “alcanzable desde un fichero”

Para evitar resultados ambiguos, el modo parcial seguirá por defecto las relaciones salientes y transitivas del fichero raíz:

- `import`, `export ... from`, `require()` e `import()` con ruta estática.
- Referencias HTML a scripts y estilos locales.
- `@import` y referencias locales relevantes en CSS.
- Llamadas o usos entre símbolos cuando puedan resolverse de forma estática.

El recorrido solo incluirá destinos dentro de la raíz del proyecto, mantendrá un conjunto de ficheros visitados y registrará los ciclos. Las dependencias externas se agruparán en nodos de paquete opcionales y no se inspeccionará su código en la primera versión.

## 4. Experiencia de usuario

### Acceso y estado vacío

- Añadir una opción **Mapa de código** en la navegación principal y una sección `#view-code-map` en `desktop/index.html`.
- Si no hay proyecto global cargado, mostrar una explicación y un acceso para ir a **Buscador Global** y cargarlo.
- Si el proyecto existe pero no contiene ficheros compatibles, mostrar las extensiones admitidas y los patrones excluidos.

### Barra de herramientas

- Selector de alcance: **Proyecto completo** / **Desde un fichero**.
- Selector de fichero raíz con búsqueda por ruta.
- Acción **Generar mapa** o **Actualizar mapa**.
- Controles de profundidad visual, agrupación por carpeta, ajuste automático, zoom y centrado.
- Filtros de ficheros, símbolos y relaciones.
- Indicadores con total de ficheros, símbolos, conexiones, advertencias y duración del análisis.

### Área principal

- Panel izquierdo opcional con árbol de carpetas y buscador.
- Lienzo central con zoom, desplazamiento, minimapa y ajuste automático.
- Nodo de fichero con cabecera de ruta, tipo, contadores y símbolos desplegables.
- Aristas diferenciadas por clase de relación, con leyenda visible y posibilidad de ocultarlas por tipo.
- Panel lateral de detalle al seleccionar un fichero, símbolo o arista.
- Acción contextual **Usar como raíz** para regenerar rápidamente un subgrafo.
- Acción **Abrir código** que muestre el fichero en el visor existente y enfoque la línea cuando sea posible.

### Control de mapas grandes

- Empezar con nodos de fichero plegados y cargar el detalle de símbolos bajo demanda.
- Agrupar visualmente por carpeta o módulo.
- Aplicar un límite inicial de nodos visibles y ofrecer ampliar el resultado conscientemente.
- Mostrar una vista resumida cuando el proyecto supere el umbral configurado.
- Ejecutar el análisis sin bloquear la interfaz y mostrar progreso cancelable.

## 5. Arquitectura propuesta

Separar el análisis del renderizado mediante un modelo intermedio estable:

```text
Proyecto global
      ↓
Descubrimiento seguro de ficheros
      ↓
Adaptador por lenguaje → AST → símbolos y referencias
      ↓
Resolución de rutas, alias y relaciones entre símbolos
      ↓
Modelo normalizado del mapa
      ↓
API local de NexusData
      ↓
Vista interactiva “Mapa de código”
```

### Backend

Crear `server/services/code-map/` con responsabilidades separadas:

- `file-discovery.js`: recorrido del proyecto, exclusiones, límites, detección de lenguaje y metadatos.
- `analyzers/javascript.js`: extracción AST de módulos, símbolos, rangos y referencias.
- `analyzers/html.js` y `analyzers/css.js`: relaciones básicas con recursos locales.
- `resolver.js`: resolución de extensiones, ficheros índice, rutas relativas y alias de `package.json`, `jsconfig.json` o `tsconfig.json`.
- `graph-builder.js`: unión de resultados, deduplicación, ciclos, cálculo de alcanzabilidad y advertencias.
- `cache.js`: reutilización por ruta, tamaño y fecha de modificación o hash.
- `index.js`: interfaz pública del servicio y validación común de opciones.

Para JavaScript/TypeScript, usar un parser AST mantenido y sin ejecución de código, por ejemplo `@babel/parser` junto con `@babel/traverse`. No se deberá evaluar, importar ni ejecutar ningún fichero analizado.

Para la visualización, evaluar `Cytoscape.js` con un layout jerárquico como Dagre. Encapsular la librería tras un adaptador de renderer para no acoplar el formato de la API a una implementación concreta.

### Frontend

Crear:

- `desktop/js/views/code-map.js`: estado de la vista, llamadas a API, eventos, filtros y coordinación de paneles.
- `desktop/js/views/code-map-graph.js`: adaptación del modelo normalizado a la librería gráfica.
- Estilos específicos en `desktop/css/views.css` y reglas adaptativas en `desktop/css/responsive.css`, o ficheros dedicados importados por `styles.css` si el volumen lo justifica.
- Estado efímero en `desktop/js/core/state.js`: alcance, fichero raíz, filtros, selección, resumen, progreso y último resultado.

Integrar la vista en `desktop/js/app.js` y `desktop/index.html`. El editor actual de `desktop/js/views/diagrams.js` seguirá siendo un producto distinto: representa diagramas manuales, mientras que el nuevo mapa será derivado, regenerable y no editable directamente.

### API local

Añadir rutas autenticadas:

- `GET /api/code-map/files`: devuelve los ficheros analizables del proyecto global para el selector de raíz.
- `POST /api/code-map/analyze`: genera un mapa completo o desde un fichero.
- `GET /api/code-map/status/:jobId`: informa del progreso si el análisis se implementa como trabajo asíncrono.
- `DELETE /api/code-map/jobs/:jobId`: cancela un análisis en curso.
- `GET /api/code-map/file?path=...&line=...`: opcional, reutilizando preferentemente el servicio de visor existente para abrir el código.

Ejemplo de solicitud:

```json
{
  "scope": "entry",
  "entryFile": "desktop/js/app.js",
  "includeExternalPackages": true,
  "excludes": ["catalogo-frontends-experimentales/**"],
  "maxFiles": 2000
}
```

El backend obtendrá la raíz desde el proyecto global guardado; no aceptará una raíz arbitraria enviada por el renderer.

## 6. Modelo de datos normalizado

El contrato no debe contener objetos AST completos. Solo transportará información necesaria para dibujar y navegar:

```json
{
  "schemaVersion": 1,
  "project": {
    "root": "/ruta/proyecto",
    "scope": "entry",
    "entryFile": "desktop/js/app.js"
  },
  "files": [
    {
      "id": "file:desktop/js/app.js",
      "path": "desktop/js/app.js",
      "language": "javascript",
      "symbols": [
        {
          "id": "symbol:desktop/js/app.js:renderView",
          "kind": "function",
          "name": "renderView",
          "exported": false,
          "range": { "startLine": 40, "endLine": 53 }
        }
      ],
      "warnings": []
    }
  ],
  "relations": [
    {
      "id": "relation:1",
      "kind": "imports",
      "from": "file:desktop/js/app.js",
      "to": "file:desktop/js/views/diagrams.js",
      "fromSymbol": null,
      "toSymbol": "symbol:desktop/js/views/diagrams.js:renderDiagrams",
      "resolved": true
    }
  ],
  "externalPackages": [],
  "warnings": [],
  "summary": {
    "files": 0,
    "symbols": 0,
    "relations": 0,
    "cycles": 0,
    "durationMs": 0,
    "truncated": false
  }
}
```

Usar rutas relativas en identificadores y respuestas normales. La ruta absoluta solo se conservará en el backend o se devolverá de forma controlada cuando sea necesaria para abrir un fichero.

## 7. Resolución y extracción

### Símbolos mínimos

- Variables y constantes declaradas a nivel de módulo.
- Funciones declaradas, expresiones de función y funciones flecha asignadas.
- Clases, constructores, métodos y propiedades de clase.
- Importaciones y exportaciones nombradas o predeterminadas.
- Funciones y valores exportados mediante CommonJS.
- Parámetros y variables locales solo en el panel de detalle, evitando saturar el nodo principal.

### Relaciones mínimas

- `imports` / `requires` entre ficheros.
- `exports` entre un fichero y sus símbolos.
- `calls` cuando origen y destino sean resolubles.
- `extends` para herencia.
- `reads` / `writes` únicamente si aportan valor y pueden mostrarse desactivadas por defecto.
- `references-script`, `references-style` e `imports-style` para HTML/CSS.

### Resolución de módulos

- Resolver rutas relativas con extensión explícita o implícita.
- Probar ficheros `index.*` en directorios.
- Interpretar alias básicos de `baseUrl` y `paths` en configuraciones JS/TS.
- Separar paquetes externos de módulos internos.
- Conservar como relaciones no resueltas los imports dinámicos no literales o alias desconocidos.
- No seguir fuera de la raíz real del proyecto después de normalizar rutas y enlaces simbólicos.

## 8. Seguridad, robustez y rendimiento

- Validar todas las rutas con `path.resolve` y `fs.realpath`, comprobando que permanezcan dentro de la raíz autorizada.
- No ejecutar código, scripts de `package.json`, transformadores ni plugins del proyecto analizado.
- Rechazar archivos demasiado grandes y limitar número de ficheros, profundidad, tiempo y memoria del análisis.
- Ignorar binarios y detectar texto no válido antes de parsear.
- Ejecutar análisis pesados en un `worker_thread` o proceso de trabajo para proteger el event loop de Express y la interfaz Electron.
- Permitir cancelación y descartar resultados de trabajos antiguos en el renderer.
- Cachear cada fichero por huella y reconstruir únicamente relaciones afectadas tras cambios.
- Invalidar la caché si cambia la configuración del parser, los alias o la versión del esquema.
- Devolver errores parciales por fichero y reservar los errores globales para problemas que impidan producir cualquier mapa.
- Evitar guardar el código fuente completo en el resultado o en logs.

## 9. Fases de implementación

### Fase 1 — Contrato y descubrimiento

- Definir el esquema versionado de solicitud, respuesta, símbolos, relaciones y errores.
- Implementar la obtención segura de la raíz desde el proyecto global.
- Crear el descubridor de ficheros, exclusiones predeterminadas y límites.
- Añadir `GET /api/code-map/files`.
- Cubrir rutas fuera del proyecto, enlaces simbólicos, carpetas ignoradas y límites con pruebas.

**Resultado:** NexusData puede enumerar de forma segura todos los ficheros analizables y elegir un fichero raíz.

### Fase 2 — Analizador JavaScript/TypeScript

- Incorporar parser y recorrido AST.
- Extraer símbolos, imports, exports, CommonJS, llamadas resolubles y herencia.
- Implementar resolución de módulos locales, extensiones, índices y alias básicos.
- Normalizar errores sintácticos como advertencias por fichero.
- Crear pruebas unitarias con fixtures JS, MJS, CJS, TS, JSX y TSX.

**Resultado:** se obtiene un modelo correcto por fichero sin ejecutar el código.

### Fase 3 — Construcción del grafo

- Combinar los análisis en un grafo estable y deduplicado.
- Implementar recorrido completo y recorrido transitivo desde una entrada.
- Detectar ciclos, paquetes externos y relaciones sin resolver.
- Añadir resumen, truncado controlado y caché incremental.
- Exponer `POST /api/code-map/analyze` inicialmente de forma síncrona para proyectos pequeños.

**Resultado:** la API devuelve el mapa completo o el subgrafo alcanzable desde un fichero.

### Fase 4 — Trabajos asíncronos

- Mover el análisis a un worker.
- Incorporar progreso, cancelación, timeout y limpieza de trabajos finalizados.
- Añadir endpoints de estado y cancelación.
- Mantener una respuesta directa para resultados obtenidos inmediatamente desde caché.

**Resultado:** los proyectos grandes no bloquean el servidor ni la interfaz.

### Fase 5 — Nueva vista

- Añadir navegación, sección HTML, estado y función de renderizado.
- Implementar estados vacío, cargando, progreso, error parcial y resultado.
- Añadir selector de alcance y fichero raíz.
- Integrar la librería gráfica mediante un adaptador.
- Implementar zoom, ajuste, agrupación por carpeta, filtros, búsqueda, plegado y panel de detalle.
- Conectar **Abrir código** con el visor existente.
- Añadir estilos responsive y navegación por teclado.

**Resultado:** el usuario puede generar, explorar y acotar el mapa desde NexusData.

### Fase 6 — HTML/CSS, calidad y documentación

- Añadir adaptadores ligeros para HTML y CSS.
- Probar proyectos mixtos y referencias cruzadas.
- Añadir métricas de duración, caché y advertencias.
- Documentar límites, significado de relaciones, exclusiones y proceso para añadir analizadores.
- Ejecutar pruebas unitarias, de integración API y de interacción de la vista.

**Resultado:** primera versión completa, documentada y preparada para crecer a otros lenguajes.

## 10. Pruebas previstas

### Unitarias

- Extracción de cada tipo de símbolo y rango de líneas.
- Imports ESM, CommonJS, dinámicos y reexportaciones.
- Resolución con extensiones, índices, alias y paquetes externos.
- Detección de ciclos y recorrido desde un fichero.
- Exclusiones, límites, rutas maliciosas, enlaces simbólicos y archivos grandes.
- Recuperación ante un fichero con sintaxis inválida.
- Estabilidad de identificadores y compatibilidad de `schemaVersion`.

### Integración

- Proyecto completo con varios módulos.
- Subgrafo desde una entrada con dependencias compartidas y ciclos.
- API autenticada, sin proyecto global y en modo offline.
- Cancelación, timeout, caché e invalidación por modificación.
- Proyecto mixto con HTML, CSS, JS y TS.

### Interfaz

- Estados sin proyecto, sin resultados, cargando, cancelado, truncado y con advertencias.
- Cambio de alcance y regeneración desde un nodo.
- Filtros combinados, búsqueda, plegado y restablecimiento del layout.
- Apertura de fichero y enfoque de línea.
- Teclado, foco visible, etiquetas accesibles, zoom y tamaños de pantalla reducidos.
- Grafo grande sin bloqueo perceptible ni pérdida de selección.

## 11. Criterios de aceptación

- Con un proyecto global cargado, la vista genera un mapa sin ejecutar su código.
- El modo completo incluye todos los ficheros compatibles no excluidos.
- El modo desde fichero incluye solamente la raíz y sus dependencias locales transitivas, respetando ciclos y límites.
- Cada fichero muestra al menos imports, exports, variables de módulo, funciones y clases detectadas.
- Las relaciones resueltas permiten identificar origen, destino, tipo y línea cuando esté disponible.
- Un error de parseo aislado aparece como advertencia y no invalida el resto del mapa.
- Ninguna ruta fuera del proyecto puede analizarse mediante manipulación de la API.
- El usuario puede buscar, filtrar, plegar, seleccionar y abrir los elementos del mapa.
- Un análisis grande se puede cancelar y no bloquea la navegación de NexusData.
- Los resultados son deterministas para el mismo código y configuración.
- Las pruebas nuevas pasan junto con `npm test` y `npm run check`.

## 12. Decisiones que deben cerrarse antes de implementar

- Umbrales predeterminados de ficheros, nodos visibles, tamaño por fichero y tiempo máximo.
- Si el primer MVP incluye TS/JSX/TSX desde el inicio o se entrega primero JS/MJS/CJS.
- Librería final de visualización tras una prueba con un grafo real de este repositorio.
- Nivel de detalle inicial de llamadas entre símbolos para equilibrar utilidad, precisión y ruido.
- Estrategia de caché: memoria durante la sesión o persistencia local versionada.
- Si **Abrir código** amplía el visor HTML actual o se crea un visor de código compartido.
- Patrones de exclusión configurables por proyecto y ubicación de esa preferencia.

