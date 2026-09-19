# Specs completas

## Versión 0.0.0

## Fix: Vista de Configuración de prompts
- Estado: Implementada
- Categoría: Fix
- Color: Rojo

Hay un espacio gigante entre los textos y la caja de contenido del prompt, soluciónalo

## Fix: Lista de specs
- Estado: Implementada
- Categoría: Fix
- Color: Rojo

Los specs ocupan si o si todo el tamaño de la lista de specs, si solo hay un spec ahora mismo ocupa todo el espacio disponible de la lista, no tiene que ocurrir, solo puede ocupar una porción en la lista

## Copiar campos
- Estado: Implementada
- Categoría: Funcional
- Color: Azul

Permite que se pueda hacer Ctrl+C o Ctrl+X en los campos de la aplicación para que se pueda copiar el texto de estos

## Guardar estado de los selectores de Specs
- Estado: Implementada
- Categoría: Funcional
- Color: Azul

Los combobox de la vista de Specs se tiene que guardar, para el combobox de ESTADO, CATEGORÍA, ORDENAR POR

## Variables globales en los prompts configurables
- Estado: Implementada
- Categoría: Funcional

Los prompts configurables pueden recibir variables globales de la aplicación. Una de ellas es la versión actual de Specs que se está editando, así que en el prompt de "Trabajar siguiendo specs" se puede añadir la instrucción de tener en cuenta solamente el fichero [version_specs_actual].md

## Fix: Prompt duplicado en Configurar prompts
- Estado: Implementada
- Categoría: Fix

En la configuración de Prompts el prompt aparece dos veces: el editor de área de texto y además la previsualización. Debe quedar solo el editor de área de texto.

## Versión 0.0.1

## Popups verdes
- Estado: Implementada
- Categoría: Fix
- Color: Rojo

Los popups verdes que aparecen arriba a la derecha impiden que pueda hacer click sobre otros controles

## Cooldown de lectura
- Estado: Implementada
- Categoría: Funcional

En la vista de Terminal permite especificar la frecuencia de actualización de la lectura del proceso de Pi (actualmente son 10 segundos)

## Carpeta de trabajo
- Estado: Implementada
- Categoría: Diseño
- Color: Amarillo

La carpeta de trabajo actual de S.D.D se mostrará en el título de la ventana electron junto al texto NexusData

## Enviar mensajes a Pi
- Estado: Implementada
- Categoría: Funcional

Se podrán enviar mensajes a Pi desde el campo de texto de Terminal sin necesidad de pulsar el botón de Play de las Specs

## Versión 0.0.2

## Visualización de ficheros
- Estado: Implementada
- Categoría: Diseño
- Color: Amarillo

El aspecto de ficheros de código exclusivamente en el visor de Documentos el texto se tiene que ver coloreado de tal manera que siga un formato de color similar al de Visual Studio code

## Versión 0.0.3

## Integración con OpenCode
- Estado: Activa
- Categoría: Funcional

De forma similar a Pi, quiero que se integre la consola de OpenCode (habrá una nueva opción combobox llamado "Tercero" en el que ahora se listará OpenCode también
