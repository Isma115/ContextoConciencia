# Precio Claro

Aplicación Electron independiente para mantener un catálogo de productos, consultar ofertas web y ordenar el catálogo desde el precio total estimado más barato al más caro.

## Qué hace

- Añade productos de uno en uno o importa un catálogo CSV.
- Busca resultados estructurados de Google Shopping a través de SerpApi, que agrega ofertas de múltiples comercios.
- Guarda las ofertas en local y muestra cada producto por su mejor precio comparable.
- Ordena automáticamente el catálogo de menor a mayor precio total estimado.
- Suma el coste de envío cuando el proveedor lo devuelve; cuando no lo conoce, lo deja indicado para que se verifique antes de comprar.
- Abre la oferta original en el navegador predeterminado, sin pasar por un navegador embebido.

## Requisitos

- Node.js 20 o superior.
- Una clave de [SerpApi](https://serpapi.com/users/sign_up) con acceso a `google_shopping`.

No existe una forma fiable ni autorizada de extraer precios de *cualquier* página de Internet sin que cada sitio permita el acceso. Por eso la aplicación usa una fuente de resultados diseñada para este uso. Los comercios que aparezcan dependerán de la cobertura de Google Shopping y de la región elegida.

## Ejecutarla

Desde esta carpeta:

```bash
npm install
npm start
```

En **Configurar búsqueda**, pega la clave de SerpApi, selecciona país, idioma y moneda, y pulsa guardar. La clave se cifra con el llavero del sistema operativo antes de persistirse.

Como alternativa, se puede suministrar sin guardarla en la aplicación:

```bash
PRECIO_CLARO_SERPAPI_KEY="tu_clave" npm start
```

## Importar un catálogo

El importador acepta CSV separado por comas o punto y coma. La columna de nombre es obligatoria; se aceptan estos nombres de cabecera:

| Campo | Cabeceras admitidas |
| --- | --- |
| Producto | `nombre`, `name`, `producto`, `product` |
| Consulta | `consulta`, `query`, `búsqueda`, `busqueda`, `search` |
| Categoría | `categoría`, `categoria`, `category` |

Puedes partir de [ejemplo-catalogo.csv](./ejemplo-catalogo.csv). Una consulta detallada, con modelo, tamaño o color, reduce los resultados que no son comparables.

## Notas de comparación

- La vista principal solo ordena precios que coinciden con la moneda configurada, para no comparar importes de divisas distintas como si fueran equivalentes.
- El mejor precio se calcula con precio base + envío si el proveedor informa del envío. Los impuestos, disponibilidad, cupones y condiciones pueden cambiar en la tienda: confirma siempre el precio final al abrir la oferta.
- Las consultas se ejecutan de dos en dos para reducir errores por límite de uso del proveedor.

## Comprobación rápida

```bash
npm run check
```
