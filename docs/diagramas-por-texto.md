# Diagramas por texto en NexusData

NexusData permite construir un diagrama escribiendo un pequeño lenguaje de texto. El formato está pensado para poder leerse, copiarse, revisarse en una conversación y guardarse como archivo `.nxd`.

## Flujo rápido

1. Abre la vista **Diagramas**.
2. Pulsa **Código** para editar el texto del diagrama.
3. Escribe o pega las instrucciones.
4. Pulsa **Generar diagrama**.
5. Usa **Exportar** para guardar el resultado como `.nxd`, o **Importar** para abrir un archivo existente.

El texto importado se muestra primero en el editor. El diagrama actual solo cambia al pulsar **Generar diagrama**, por lo que puedes revisar o corregir el contenido antes de aplicarlo.

## Estructura básica

Un archivo puede contener tres instrucciones:

```text
diagram "Flujo de acceso"

node inicio "Inicio" start at 100, 180
node validar "Validar credenciales" decision at 420, 180
node panel "Panel principal" end at 760, 180

edge inicio -> validar "Enviar datos" forward
edge validar -> panel "Credenciales válidas" forward
```

El orden recomendado es:

1. Una declaración `diagram` con el título.
2. Todas las declaraciones `node`.
3. Todas las declaraciones `edge`.

Las conexiones también pueden aparecer antes que los nodos, pero sus identificadores tienen que existir cuando se genera el diagrama.

## Declaración del diagrama

```text
diagram "Nombre del diagrama"
```

Solo puede haber una declaración `diagram`. El título debe ir entre comillas. Si se omite, se usa `Diagrama generado`.

## Nodos

```text
node identificador "Etiqueta visible" tipo at x, y
```

Partes de la instrucción:

- `identificador`: nombre único, sin espacios. Puede usar letras, números, guiones y guiones bajos, pero debe comenzar por una letra o guion bajo.
- `Etiqueta visible`: texto que aparecerá dentro de la tarjeta. Debe ir entre comillas.
- `tipo`: opcional; si se omite, el nodo es un paso normal.
- `at x, y`: opcional; fija la posición de la tarjeta en el lienzo de 1400 × 900 unidades.

Tipos disponibles:

| Lenguaje | Alias en español | Apariencia |
| --- | --- | --- |
| `start` | `inicio` | Inicio |
| `step` | `paso` | Paso normal |
| `decision` | `decisión` | Decisión |
| `end` | `fin` | Fin |

Ejemplos:

```text
node recibir "Recibir solicitud"
node revisar "¿Está completa?" decision at 360, 260
node corregir "Pedir corrección" paso at 650, 390
node terminado "Proceso terminado" fin at 650, 130
```

Si no se indica `at`, NexusData coloca los nodos automáticamente en una cuadrícula. Las posiciones negativas o fuera del lienzo se ajustan a sus límites.

## Conexiones

```text
edge origen -> destino "Texto opcional" dirección
```

La etiqueta y la dirección son opcionales:

```text
edge recibir -> revisar
edge revisar -> terminado "Sí" forward
edge revisar -> corregir "No" backward
edge corregir -> recibir "Reintentar" none
```

Direcciones disponibles:

- `forward`: flecha hacia el destino. También acepta `directo`.
- `backward`: flecha hacia el origen. También acepta `reverse` o `reversa`.
- `none`: línea simple sin flecha. También acepta `simple`.

La etiqueta debe ir entre comillas. También se admite separar la etiqueta con dos puntos:

```text
edge revisar -> terminado : "Sí, continuar" forward
```

## Comentarios y comillas

Las líneas vacías se ignoran. Las líneas que empiezan por `#` o `//` son comentarios:

```text
# Entrada del sistema
// La decisión tiene dos salidas
node entrada "Cargar datos" start
```

Para escribir comillas dentro de una etiqueta, escápalas con una barra invertida:

```text
node aviso "Mostrar \"Acceso concedido\"" end
```

Las etiquetas pueden incluir tildes, signos y espacios. No pongas un comentario al final de una instrucción; si el carácter forma parte de una etiqueta, escríbelo dentro de las comillas.

## Ejemplo completo

```text
diagram "Registro de usuario"

# Entradas y validaciones
node formulario "Completar formulario" start at 100, 300
node validar "Validar datos" decision at 380, 300
node guardar "Guardar usuario" step at 680, 180
node error "Mostrar errores" step at 680, 430
node fin "Cuenta creada" end at 980, 180

edge formulario -> validar "Enviar" forward
edge validar -> guardar "Correctos" forward
edge validar -> error "Incorrectos" forward
edge guardar -> fin "Confirmar" forward
edge error -> formulario "Corregir" backward
```

## Errores habituales

- **Identificador repetido**: cada `node` necesita un identificador diferente.
- **Nodo inexistente**: el origen y el destino de cada `edge` deben coincidir exactamente con un identificador declarado.
- **Etiqueta sin comillas**: usa `"texto con espacios"`, no `texto con espacios`.
- **Flecha incorrecta**: escribe `->` entre el origen y el destino.
- **Posición inválida**: usa dos números separados por una coma, por ejemplo `at 420, 180`.
- **Instrucción desconocida**: las únicas instrucciones son `diagram`, `node` y `edge` (también se acepta `connect` como alias de `edge`).

El editor indica la línea del primer error encontrado. Corrige ese error y vuelve a pulsar **Generar diagrama**.

## Compatibilidad del archivo

El formato `.nxd` es texto plano UTF-8. Por eso puede:

- guardarse en Git junto al código del proyecto;
- detectarse e indexarse automáticamente cuando se sincroniza una carpeta local de documentación;
- generarse desde un script o una respuesta de un agente de IA;
- copiarse y pegarse en el botón **Código**;
- editarse con cualquier editor de texto;
- exportarse de nuevo desde NexusData sin perder las posiciones, tipos, etiquetas ni conexiones.

La exportación siempre escribe la forma canónica del lenguaje para que el siguiente ciclo de importación sea predecible.
