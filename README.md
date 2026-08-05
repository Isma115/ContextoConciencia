# NexusData

NexusData es una aplicación de escritorio Electron para centralizar documentación, configuraciones, notas técnicas y respuestas de APIs REST en una base de datos SQLite local. Las cuentas y sesiones se almacenan separadamente en MySQL.

## Requisitos

- Node.js 22.5 o superior (usa `node:sqlite`).
- pnpm y Docker Compose.

## Puesta en marcha

```bash
# Opcional: cp .env.example .env
pnpm install
pnpm db:up
npm run dev
```

`.env` es opcional; si no existe, la aplicación genera automáticamente el secreto de sesión necesario para el modo offline.

MySQL tarda unos segundos en declarar su estado saludable la primera vez. La interfaz mostrará la pantalla de acceso; registra una cuenta (usuario de 3–50 caracteres y contraseña de 8–32) para continuar. También puedes elegir **Entrar offline** para trabajar sin iniciar sesión y sin MySQL: en ese modo solo se muestran, editan y sincronizan las fuentes de archivos locales del equipo; las fuentes REST no están disponibles.

También se puede levantar solo la API para desarrollo:

```bash
pnpm server
```

La API queda disponible en `http://127.0.0.1:3000/api` y la base de datos de desarrollo en `data/nexusdata.db`. Electron carga esta misma URL para que la cookie de sesión `HttpOnly` no salga del mismo origen.

## Fuente HTTP de prueba

El proyecto incluye un servidor auxiliar con un documento Markdown para probar la obtención de documentos a través de una IP. Arráncalo en otra terminal:

```bash
pnpm test-source
```

Escucha en todas las interfaces de red por el puerto `4100` y muestra en la terminal las URLs disponibles. Sus rutas son:

- `GET http://IP_DEL_EQUIPO:4100/documents`: índice JSON compatible con una fuente REST de NexusData.
- `GET http://IP_DEL_EQUIPO:4100/documents/documento-prueba.md`: documento Markdown en crudo.
- `GET http://IP_DEL_EQUIPO:4100/health`: comprobación de estado.

Para importarlo desde la aplicación, añade una fuente **API REST** con la URL `http://IP_DEL_EQUIPO:4100/documents` y conserva el mapeo predeterminado: `id`, `title` y `description`. Si haces la prueba desde el mismo equipo puedes usar `127.0.0.1`; desde otro equipo de la red local, utiliza una de las IP que imprime el servidor y permite conexiones al puerto `4100` en el cortafuegos.

El puerto y la interfaz se pueden cambiar con `TEST_SOURCE_PORT` y `TEST_SOURCE_HOST`, por ejemplo:

```bash
TEST_SOURCE_PORT=4200 pnpm test-source
```

## Autenticación

- `POST /api/auth/register`: crea la cuenta e inicia sesión.
- `POST /api/auth/login`: inicia sesión.
- `POST /api/auth/offline`: inicia una sesión local sin credenciales, limitada a contenido de fuentes locales.
- `GET /api/auth/me`: devuelve el usuario activo.
- `POST /api/auth/logout`: cierra la sesión.

Todas las rutas de datos exigen una sesión válida, incluso en modo offline. Las únicas rutas públicas son `GET /api/health` y `/api/auth/*`. Las contraseñas se guardan únicamente como hashes bcrypt (coste 12), nunca como texto plano.

## MySQL Workbench

Crea una conexión de tipo **Standard TCP/IP** con host `127.0.0.1`, puerto `3306`, usuario `nexusdata_app`, contraseña `MYSQL_PASSWORD` y esquema predeterminado `nexusdata_auth`.

Puedes comprobarla con:

```sql
SELECT 1;
SELECT id, usuario, creado_en, actualizado_en FROM usuarios;
```

`password_hash` contiene hashes bcrypt no recuperables, no contraseñas.

## Funcionalidades

- Importación de archivos y carpetas JSON, CSV, TXT, Markdown, HTML, CSS y JavaScript.
- Visor HTML para previsualizar proyectos locales con sus hojas de estilo y scripts enlazados.
- Proyecto global persistente: crea o carga una carpeta para definir los recursos principales que iterará la aplicación.
- Buscador Global con los mismos filtros que Buscar y gestión de fuentes externas adicionales desde la misma vista.
- La aplicación arranca en Buscador Global; primero se selecciona la carpeta del proyecto y después se habilita su índice.
- Fuentes REST GET con cabeceras y mapeo configurable.
- Sincronización manual con altas y actualizaciones por identificador.
- Búsqueda exacta, parcial y aproximada con Fuse.js.
- Filtros por fuente, tipo, etiqueta, colección y fecha.
- Etiquetas, colecciones y origen visible de cada documento.
- Electron con `nodeIntegration: false` y `contextIsolation: true`.

## API principal

Las rutas están documentadas en `GOAL.md`. Además, se incluyen `GET /api/health`, `GET /api/stats` y las rutas auxiliares de etiquetas necesarias para organizar documentos desde la interfaz.
# ContextoConciencia
