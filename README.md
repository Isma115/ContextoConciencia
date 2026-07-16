# NexusData

NexusData es una aplicación de escritorio Electron para centralizar documentación, configuraciones, notas técnicas y respuestas de APIs REST en una base de datos SQLite local. Las cuentas y sesiones se almacenan separadamente en MySQL.

## Requisitos

- Node.js 22.5 o superior (usa `node:sqlite`).
- pnpm y Docker Compose.

## Puesta en marcha

```bash
cp .env.example .env
pnpm install
pnpm db:up
pnpm start
```

MySQL tarda unos segundos en declarar su estado saludable la primera vez. La interfaz mostrará la pantalla de acceso; registra una cuenta (usuario de 3–50 caracteres y contraseña de 8–32) para continuar. También puedes elegir **Entrar offline** para trabajar sin iniciar sesión y sin MySQL: en ese modo solo se muestran, editan y sincronizan las fuentes de archivos locales del equipo; las fuentes REST no están disponibles.

También se puede levantar solo la API para desarrollo:

```bash
pnpm server
```

La API queda disponible en `http://127.0.0.1:3000/api` y la base de datos de desarrollo en `data/nexusdata.db`. Electron carga esta misma URL para que la cookie de sesión `HttpOnly` no salga del mismo origen.

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

- Importación de archivos y carpetas JSON, CSV, TXT y Markdown.
- Fuentes REST GET con cabeceras y mapeo configurable.
- Sincronización manual con altas y actualizaciones por identificador.
- Búsqueda exacta, parcial y aproximada con Fuse.js.
- Filtros por fuente, tipo, etiqueta, colección y fecha.
- Etiquetas, colecciones y origen visible de cada documento.
- Electron con `nodeIntegration: false` y `contextIsolation: true`.

## API principal

Las rutas están documentadas en `GOAL.md`. Además, se incluyen `GET /api/health`, `GET /api/stats` y las rutas auxiliares de etiquetas necesarias para organizar documentos desde la interfaz.
# ContextoConciencia
