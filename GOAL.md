# NexusData — Centro de Información para Desarrollo de Software

## 1. Descripción

**NexusData** es una aplicación de escritorio pensada para desarrolladores de software que necesitan reunir, consultar y organizar información técnica procedente de distintas fuentes desde una única interfaz.

La aplicación permitirá centralizar:

- Documentación de proyectos.
- Archivos de configuración.
- Notas técnicas.
- Respuestas de APIs.
- Archivos JSON, CSV, TXT y Markdown.
- Información de entornos.
- Datos de pruebas.
- Referencias de servicios.
- Fragmentos de información relacionados con proyectos.

El sistema estará desarrollado con:

- Electron.
- HTML.
- CSS.
- JavaScript.
- Node.js.
- Express.
- SQLite.
- Fuse.js para búsqueda aproximada.

---

## 2. Objetivo

El objetivo principal es crear una herramienta de escritorio que ayude a un desarrollador a tener localizada y organizada toda la información técnica que utiliza en su trabajo diario.

La aplicación permitirá:

1. Añadir archivos o carpetas locales.
2. Conectar una API REST.
3. Importar y almacenar información.
4. Buscar contenido desde un único buscador.
5. Encontrar coincidencias exactas, parciales o similares.
6. Organizar documentos por etiquetas y colecciones.
7. Identificar siempre el origen de cada resultado.
8. Consultar información técnica sin cambiar constantemente de herramienta.

---

## 3. Casos de uso

### Consultar documentación de proyectos

El desarrollador podrá importar archivos Markdown, TXT o JSON con documentación interna, requisitos, decisiones técnicas o notas de implementación.

### Revisar respuestas de APIs

La aplicación podrá conectarse a endpoints REST y guardar la información obtenida para su consulta posterior.

### Centralizar configuraciones

Podrán almacenarse archivos de configuración, ejemplos de variables de entorno, estructuras JSON y datos relacionados con diferentes entornos.

### Buscar información técnica

El usuario podrá localizar rápidamente una referencia, una propiedad, un nombre de servicio, una ruta, un identificador o una nota técnica.

### Agrupar información por proyecto

Los documentos podrán organizarse en colecciones como:

```text
Proyecto Alpha
├── Documentación
├── Endpoints
├── Configuración
├── Notas técnicas
└── Datos de prueba
```

---

## 4. Fuentes de información

La aplicación trabajará inicialmente con dos tipos de fuente.

### Archivos locales

Formatos admitidos:

- JSON.
- CSV.
- TXT.
- Markdown.

El usuario podrá seleccionar un archivo o una carpeta. La aplicación leerá su contenido y lo guardará en SQLite.

Ejemplos de archivos útiles:

- `README.md`
- `config.json`
- `routes.txt`
- `test-data.csv`
- `notes.md`

### API REST

El usuario podrá configurar una fuente REST indicando:

- Nombre.
- URL.
- Método GET.
- Cabeceras opcionales.
- Campo identificador.
- Campo de título.
- Campo de contenido.

Ejemplo:

```json
{
  "name": "API de incidencias",
  "type": "rest",
  "url": "https://api.example.com/issues",
  "headers": {
    "Authorization": "Bearer TOKEN"
  },
  "mapping": {
    "id": "id",
    "title": "title",
    "content": "description"
  }
}
```

---

## 5. Arquitectura

La aplicación se dividirá en tres partes.

```text
┌──────────────────────────────┐
│       Aplicación Electron    │
│                              │
│  HTML + CSS + JavaScript     │
│  Interfaz de usuario         │
└──────────────┬───────────────┘
               │ HTTP
┌──────────────▼───────────────┐
│       Servidor Node.js       │
│                              │
│  Express                     │
│  Importación                 │
│  Búsqueda                    │
│  Sincronización              │
└──────────────┬───────────────┘
               │
┌──────────────▼───────────────┐
│           SQLite            │
│                              │
│  Fuentes                     │
│  Documentos                  │
│  Etiquetas                   │
│  Colecciones                 │
└──────────────────────────────┘
```

Electron se encargará de la interfaz.

Node.js gestionará la importación, la búsqueda y el acceso a fuentes externas.

SQLite almacenará la información de forma local.

---

## 6. Funcionalidades principales

### 6.1. Gestión de fuentes

El desarrollador podrá:

- Crear una fuente.
- Editar su configuración.
- Probar la conexión.
- Sincronizarla.
- Eliminarla.
- Consultar su estado.

Cada fuente tendrá:

```text
id
nombre
tipo
configuración
estado
fecha de creación
última sincronización
```

### 6.2. Importación de archivos

El proceso de importación será:

1. Seleccionar archivo o carpeta.
2. Detectar el formato.
3. Leer el contenido.
4. Extraer información básica.
5. Guardar el documento.
6. Registrar su ruta de origen.

Ejemplo de documento:

```json
{
  "sourceId": "source_01",
  "externalId": "readme_project_alpha",
  "title": "README del Proyecto Alpha",
  "content": "Documentación principal del proyecto",
  "type": "markdown",
  "path": "/projects/alpha/README.md"
}
```

### 6.3. Conexión con API REST

La aplicación recuperará datos de una API mediante peticiones GET.

El usuario podrá decidir qué campos de la respuesta se utilizarán como:

- Identificador.
- Título.
- Contenido.
- Metadatos.

### 6.4. Sincronización

La sincronización será manual.

Cuando el usuario pulse **Sincronizar**, el servidor:

1. Leerá la fuente.
2. Recuperará los datos.
3. Comparará los identificadores.
4. Creará o actualizará documentos.
5. Guardará la fecha de sincronización.
6. Mostrará posibles errores.

---

## 7. Búsqueda global

La búsqueda será una de las funciones principales de NexusData.

### Búsqueda exacta

Buscará el término tal como fue escrito.

```text
DATABASE_URL
```

### Búsqueda parcial

Permitirá encontrar resultados aunque se escriba solo una parte.

```text
auth
```

Podrá encontrar:

```text
authentication
authorization
auth-service
```

### Búsqueda aproximada

Permitirá encontrar resultados aunque exista un pequeño error de escritura.

```text
configruation
```

Podrá devolver:

```text
configuration
```

La búsqueda aproximada se implementará con Fuse.js.

### Campos analizados

La búsqueda se aplicará sobre:

- Título.
- Contenido.
- Ruta.
- Tipo.
- Etiquetas.
- Metadatos.

### Orden de resultados

Los resultados se ordenarán según:

- Coincidencia en el título.
- Coincidencia en el contenido.
- Similitud del término.
- Fecha de actualización.

Ejemplo:

```json
{
  "query": "authentication service",
  "total": 8,
  "results": [
    {
      "id": "doc_01",
      "title": "Configuración del servicio de autenticación",
      "source": "Documentación local",
      "score": 0.94,
      "snippet": "El servicio de autenticación utiliza..."
    }
  ]
}
```

### Filtros

La búsqueda podrá filtrarse por:

- Fuente.
- Tipo de archivo.
- Etiqueta.
- Proyecto.
- Fecha.

---

## 8. Organización de la información

### Etiquetas

Las etiquetas permitirán clasificar documentos.

Ejemplos:

```text
frontend
backend
api
database
deployment
testing
documentation
```

### Colecciones

Las colecciones permitirán agrupar información relacionada.

Ejemplos:

- Proyecto Alpha.
- Entorno de producción.
- API de usuarios.
- Documentación de despliegue.
- Errores frecuentes.
- Referencias técnicas.

---

## 9. Interfaz

### Menú lateral

```text
Inicio
Buscar
Fuentes
Colecciones
Configuración
```

### Inicio

La pantalla principal mostrará:

- Número de documentos.
- Fuentes configuradas.
- Última sincronización.
- Documentos recientes.
- Colecciones recientes.

### Búsqueda

La pantalla de búsqueda incluirá:

- Campo de consulta.
- Filtros.
- Lista de resultados.
- Fragmento de contenido.
- Tipo de documento.
- Fuente.
- Ruta original.
- Puntuación de similitud.

### Fuentes

La pantalla de fuentes permitirá:

- Añadir una fuente local.
- Añadir una API REST.
- Editar una fuente.
- Probarla.
- Sincronizarla.
- Eliminarla.

---

## 10. Base de datos

### Tabla `sources`

```text
id
name
type
config_json
status
created_at
last_sync_at
```

### Tabla `documents`

```text
id
source_id
external_id
title
content
type
path
metadata_json
created_at
updated_at
```

### Tabla `tags`

```text
id
name
```

### Tabla `document_tags`

```text
document_id
tag_id
```

### Tabla `collections`

```text
id
name
description
created_at
```

### Tabla `collection_items`

```text
collection_id
document_id
```

---

## 11. API

Ruta base:

```text
/api
```

### Fuentes

```text
GET    /api/sources
POST   /api/sources
PUT    /api/sources/:id
DELETE /api/sources/:id
POST   /api/sources/:id/test
POST   /api/sources/:id/sync
```

### Documentos

```text
GET /api/documents
GET /api/documents/:id
```

### Búsqueda

```text
GET /api/search?q=texto
```

### Colecciones

```text
GET    /api/collections
POST   /api/collections
POST   /api/collections/:id/items
DELETE /api/collections/:id/items/:documentId
```

---

## 12. Estructura del proyecto

```text
nexusdata/
├── desktop/
│   ├── main.js
│   ├── preload.js
│   ├── index.html
│   ├── css/
│   └── js/
├── server/
│   ├── app.js
│   ├── routes/
│   ├── services/
│   ├── database/
│   └── importers/
├── data/
│   └── nexusdata.db
├── package.json
└── README.md
```

---

## 13. Seguridad

La aplicación aplicará medidas básicas de seguridad:

- `nodeIntegration` desactivado.
- `contextIsolation` activado.
- Validación de datos.
- Consultas SQL parametrizadas.
- Tokens fuera del código fuente.
- Restricción de rutas accesibles.
- Ocultación de credenciales en la interfaz.

Configuración recomendada:

```javascript
const window = new BrowserWindow({
  width: 1400,
  height: 900,
  webPreferences: {
    preload: path.join(__dirname, "preload.js"),
    nodeIntegration: false,
    contextIsolation: true
  }
});
```

---

## 14. Fases de desarrollo

### Fase 1

- Crear el proyecto Electron.
- Crear el servidor Express.
- Configurar SQLite.
- Conectar Electron con la API.

### Fase 2

- Crear gestión de fuentes.
- Importar JSON, CSV, TXT y Markdown.
- Guardar documentos.

### Fase 3

- Crear conexión REST.
- Añadir sincronización manual.
- Mostrar errores.

### Fase 4

- Implementar búsqueda exacta.
- Implementar búsqueda parcial.
- Añadir Fuse.js.
- Crear filtros.

### Fase 5

- Añadir etiquetas.
- Añadir colecciones.
- Mejorar la interfaz.
- Preparar el instalador.

---

## 15. Criterios de finalización

El proyecto estará completo cuando permita:

- Abrir la aplicación Electron.
- Añadir archivos o carpetas locales.
- Añadir una API REST.
- Importar información.
- Sincronizar fuentes.
- Buscar por texto.
- Encontrar resultados similares.
- Filtrar resultados.
- Etiquetar documentos.
- Crear colecciones.
- Ver el origen de cada elemento.

---

## 16. Mejoras futuras

- Sincronización automática.
- Importación de PDF.
- Conexión con bases de datos.
- Búsqueda semántica.
- Exportación de resultados.
- Copias de seguridad.
- Aplicación web.
- Historial de consultas.
- Panel de actividad.
- Detección de duplicados.

---

## 17. Conclusión

NexusData será una herramienta de escritorio orientada al trabajo diario de un desarrollador de software.

Permitirá centralizar documentación, archivos de configuración, respuestas de APIs, notas técnicas y datos de proyectos. Su buscador facilitará la localización de información exacta o similar, mientras que las etiquetas y colecciones permitirán organizar el contenido según proyectos, tecnologías o áreas de trabajo.

El proyecto mostrará conocimientos de Electron, Node.js, Express, SQLite, integración con APIs, procesamiento de archivos y búsqueda aproximada.
