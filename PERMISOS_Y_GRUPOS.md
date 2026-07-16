# Sistema de gestión de permisos y grupos

## 1. Objetivo

NexusData necesita controlar qué fuentes, documentos y colecciones puede consultar o modificar cada usuario.

Se propone un modelo híbrido **RBAC + ACL**:

- Los **grupos** simplifican la administración de usuarios con necesidades similares.
- Las **listas de control de acceso** determinan qué usuario o grupo puede acceder a cada recurso.
- Los permisos se validan siempre en el servidor, no únicamente ocultando elementos en la interfaz.

## 2. Grupos

Cada usuario puede pertenecer a varios grupos. Algunos ejemplos:

- Administradores.
- Desarrollo.
- Soporte.
- Proyecto Alpha.
- Invitados.

Los grupos no conceden acceso por su nombre. Reciben permisos explícitos sobre el espacio completo o sobre recursos concretos.

## 3. Niveles de acceso

Sobre cada recurso se puede conceder uno de estos niveles:

| Nivel | Capacidades |
|---|---|
| Lector | Ver y buscar contenido |
| Editor | Leer, editar, etiquetar y organizar |
| Gestor | Editar, eliminar y administrar accesos |
| Administrador | Acceso global y gestión de usuarios y grupos |

Los permisos pueden aplicarse a:

- El espacio completo de NexusData.
- Fuentes.
- Documentos.
- Colecciones.

## 4. Políticas de visibilidad

Cada recurso tendrá una política de visibilidad:

- `authenticated`: visible para cualquier usuario autenticado.
- `restricted`: visible sólo mediante una concesión a un usuario o grupo.
- `private`: visible únicamente para su propietario y los administradores.
- `inherit`: hereda la política del recurso padre.

### Reglas de resolución

1. Un administrador puede acceder a todo.
2. Un documento hereda el acceso de su fuente por defecto.
3. Una concesión directa al usuario se combina con las concesiones de sus grupos.
4. Si existen varias concesiones, se utiliza el nivel más alto.
5. Si no existe una concesión válida, se deniega el acceso.
6. Una colección no concede automáticamente acceso a sus documentos: sólo muestra los documentos que el usuario ya puede consultar.
7. Cuando un recurso está oculto para el usuario, la API responde `404` para no revelar su existencia.

En la primera versión no se incluirán permisos explícitos de tipo `deny`. Un modelo basado en lista blanca tiene reglas de precedencia más sencillas y cubre las necesidades iniciales.

## 5. Modelo de datos

Los usuarios y sus contraseñas continuarán almacenados en MySQL. Los grupos y permisos se almacenarán en SQLite junto al contenido.

El campo `user_id` será una referencia externa al identificador de usuario de MySQL. De este modo, los permisos serán locales a cada repositorio NexusData y las consultas de contenido podrán filtrarse eficientemente.

```sql
CREATE TABLE groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE group_members (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  is_group_manager INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE resource_policies (
  resource_type TEXT NOT NULL
    CHECK (resource_type IN ('workspace', 'source', 'document', 'collection')),
  resource_id TEXT NOT NULL,
  visibility TEXT NOT NULL
    CHECK (visibility IN ('authenticated', 'restricted', 'private', 'inherit')),
  owner_user_id INTEGER,
  PRIMARY KEY (resource_type, resource_id)
);

CREATE TABLE resource_grants (
  id TEXT PRIMARY KEY,
  principal_type TEXT NOT NULL
    CHECK (principal_type IN ('user', 'group')),
  principal_id TEXT NOT NULL,
  resource_type TEXT NOT NULL
    CHECK (resource_type IN ('workspace', 'source', 'document', 'collection')),
  resource_id TEXT NOT NULL,
  access_level TEXT NOT NULL
    CHECK (access_level IN ('reader', 'editor', 'manager')),
  created_at TEXT NOT NULL,
  UNIQUE (principal_type, principal_id, resource_type, resource_id)
);

CREATE INDEX idx_group_members_user
  ON group_members(user_id);

CREATE INDEX idx_resource_grants_principal
  ON resource_grants(principal_type, principal_id);

CREATE INDEX idx_resource_grants_resource
  ON resource_grants(resource_type, resource_id);
```

Los permisos son polimórficos y no pueden tener una clave foránea directa hacia todas las posibles tablas de recursos. Por ello, sus concesiones y políticas se eliminarán en la misma transacción que elimina la fuente, documento o colección correspondiente.

## 6. Permisos por operación

| Operación | Permiso mínimo |
|---|---|
| Consultar o buscar un documento | Lector |
| Ver una fuente o colección | Lector |
| Editar un documento | Editor |
| Añadir o quitar etiquetas | Editor |
| Organizar documentos en colecciones | Editor |
| Sincronizar una fuente | Gestor |
| Ver o modificar secretos de una fuente | Gestor |
| Eliminar contenido | Gestor |
| Compartir un recurso | Gestor |
| Gestionar usuarios y grupos | Administrador |

## 7. Aplicación en el servidor

La autorización debe realizarse siempre en Express. Ocultar botones o elementos en Electron mejora la experiencia de usuario, pero no constituye una medida de seguridad.

Se creará un servicio de autorización con operaciones equivalentes a:

```js
can(userId, action, resourceType, resourceId)
visibleDocumentClause(userId)
requirePermission(action, resourceType)
```

Ejemplo de protección de una ruta:

```js
app.put(
  '/api/documents/:id',
  requirePermission('edit', 'document'),
  updateDocument
);
```

### Consultas que deben filtrarse

- `/api/documents`: devuelve sólo documentos visibles.
- `/api/documents/:id`: comprueba el permiso de lectura.
- `/api/search`: filtra los documentos antes de ejecutar Fuse.js.
- `/api/stats`: cuenta únicamente los recursos visibles.
- `/api/tags`: calcula cantidades sólo sobre documentos visibles.
- `/api/collections/:id`: omite documentos no autorizados.
- `/api/sources`: no expone configuración ni cabeceras sin permiso de gestión.
- Operaciones de sincronización y configuración: requieren nivel `manager`.

El filtrado debe realizarse en SQLite antes de construir la respuesta. Nunca se enviará contenido no autorizado al cliente para ocultarlo posteriormente con JavaScript.

## 8. API de administración

### Grupos

```text
GET    /api/groups
POST   /api/groups
PUT    /api/groups/:id
DELETE /api/groups/:id

GET    /api/groups/:id/members
POST   /api/groups/:id/members
DELETE /api/groups/:id/members/:userId
```

### Acceso a recursos

```text
GET    /api/access/:resourceType/:resourceId
PUT    /api/access/:resourceType/:resourceId/policy
POST   /api/access/:resourceType/:resourceId/grants
DELETE /api/access/:resourceType/:resourceId/grants/:grantId
```

La ruta `/api/auth/me` incluirá las capacidades globales necesarias para construir la interfaz:

```json
{
  "user": {
    "id": 7,
    "username": "ada",
    "isAdmin": false
  },
  "capabilities": {
    "manageUsers": false,
    "manageGroups": false
  }
}
```

No se incluirá la lista completa de permisos en el JWT. Los permisos se resolverán en cada petición para que retirar a un usuario de un grupo tenga efecto inmediato.

## 9. Gestión del alta de usuarios

Cuando se active el sistema de permisos, el registro abierto actual deberá ajustarse:

- El primer usuario será el administrador inicial.
- Los usuarios posteriores entrarán en un grupo predeterminado sin acceso o se registrarán mediante invitación.
- La variable `INITIAL_ADMIN_USERNAME` podrá utilizarse para configurar el administrador durante el arranque.
- Sólo los administradores podrán gestionar grupos o conceder permisos.

## 10. Interfaz de usuario

La aplicación Electron incorporará:

- Una pantalla de administración de grupos.
- Un selector de miembros para cada grupo.
- Una acción **Compartir y permisos** en fuentes, documentos y colecciones.
- Un selector de visibilidad.
- Una lista de usuarios y grupos con acceso.
- Controles para elegir el nivel `reader`, `editor` o `manager`.
- Botones de edición, sincronización o eliminación visibles sólo cuando el usuario tenga la capacidad correspondiente.

La interfaz puede usar los permisos para decidir qué controles mostrar, pero el servidor seguirá validando todas las operaciones.

## 11. Plan de implantación

1. Crear las tablas de autorización.
2. Asignar la política `authenticated` al contenido existente para conservar el comportamiento actual.
3. Crear el administrador inicial y el grupo predeterminado.
4. Incorporar el servicio de autorización y sus pruebas unitarias.
5. Filtrar listados, búsquedas, estadísticas y agregaciones.
6. Proteger todas las operaciones de escritura.
7. Añadir las rutas de administración de grupos y permisos.
8. Incorporar la interfaz de administración en Electron.
9. Cambiar gradualmente fuentes y documentos de `authenticated` a `restricted`.

## 12. Pruebas esenciales

El sistema deberá verificar al menos los siguientes escenarios:

- Un documento restringido no aparece en listados.
- Un documento restringido no aparece en búsquedas.
- Su existencia no se filtra mediante estadísticas, etiquetas o colecciones.
- Un usuario obtiene acceso al incorporarse a un grupo autorizado.
- El acceso se revoca inmediatamente al retirarlo del grupo.
- Un lector no puede modificar documentos.
- Un editor no puede administrar permisos.
- Un gestor puede compartir recursos, pero no gestionar usuarios globales.
- Una colección no permite acceder indirectamente a documentos ocultos.
- Los secretos de las fuentes sólo se muestran a gestores y administradores.
- Los recursos existentes siguen siendo visibles después de la migración inicial.

## 13. Archivos afectados durante la implementación

La implementación tendrá impacto principalmente en:

- `server/database/db.js`: esquema y consultas filtradas.
- `server/auth.js`: identidad y capacidades globales.
- `server/routes/index.js`: protección de rutas y filtrado de resultados.
- `server/database/mysql.js`: consulta y administración de usuarios.
- `desktop/js/app.js`: interfaz condicionada por permisos.
- `desktop/index.html`: administración de grupos y diálogo de permisos.
- `test/nexusdata.test.js`: pruebas de autorización y ausencia de filtraciones.
