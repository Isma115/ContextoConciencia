import { state } from './state.js';
import { readStoredSddActiveVersion, readStoredSddProjectPath } from './sdd-storage.js';

// Variables globales de la aplicación disponibles en cualquier prompt configurable.
//
// Un prompt puede escribir el token `[nombre_variable]` y el programa lo sustituye
// al construir el prompt (al copiarlo, por ejemplo). El token se resuelve siempre
// con el estado real de la aplicación, así que el mismo prompt sirve para cualquier
// proyecto o versión de specs sin reescribirlo.
//
// Reglas de los tokens: letras, números y guion bajo, sin espacios. Se aceptan
// mayúsculas, minúsculas o mezcla; la búsqueda del valor no distingue mayúsculas.
//
// Además de las variables globales, cada prompt puede definir sus propios tokens
// (`[FUNCIONALIDAD]`, por ejemplo) pasándolos al resolver; esos tienen prioridad
// sobre las variables globales con el mismo nombre.

const SPECS_EXTENSION = '.md';
const TOKEN_NAME_PATTERN = /^[A-Za-z0-9_]+$/;
const SDD_SPECS_DIR = 'SDD_specs';
const SDD_VERSIONS_DIR = 'specs';
const SDD_FULL_FILE = 'specs_full.md';
const SDD_DATABASE_FILE = 'bbdd.md';
const SDD_RESOURCES_DIR = 'specs_resources';

function text(value, maxLength = 400) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function sddProject() {
  const current = state?.sddProject && typeof state.sddProject === 'object' ? state.sddProject : null;
  if (current) return current;
  // Todavía no se ha cargado el proyecto S.D.D. en esta sesión: se usan la ruta y
  // la versión recordadas para que las variables ya tengan valor.
  try {
    const path = readStoredSddProjectPath();
    if (!path) return null;
    return {
      path,
      name: path.split(/[\\/]/).filter(Boolean).pop() || '',
      activeVersion: readStoredSddActiveVersion(path)
    };
  } catch {
    return null;
  }
}

function specsVersionName({ includeExtension = false } = {}) {
  const name = text(sddProject()?.activeVersion, 200).replace(/\.md$/i, '');
  if (!name) return '';
  return includeExtension ? `${name}${SPECS_EXTENSION}` : name;
}

function specsVersionPath() {
  const fileName = specsVersionName({ includeExtension: true });
  return fileName ? `${SDD_SPECS_DIR}/${SDD_VERSIONS_DIR}/${fileName}` : '';
}

function variableEntry(definition) {
  const value = String(definition.value() ?? '');
  return {
    token: `[${definition.token}]`,
    tokenName: definition.token,
    label: definition.label,
    description: definition.description,
    available: Boolean(value),
    value
  };
}

const GLOBAL_VARIABLE_DEFINITIONS = Object.freeze([
  Object.freeze({
    token: 'version_specs_actual',
    label: 'Versión de specs actual',
    description: 'Versión de specs activa en S.D.D., sin la extensión .md.',
    value: () => specsVersionName()
  }),
  Object.freeze({
    token: 'archivo_specs_actual',
    label: 'Archivo de la versión',
    description: 'Nombre del archivo de la versión activa, por ejemplo 1.2.0.md.',
    value: () => specsVersionName({ includeExtension: true })
  }),
  Object.freeze({
    token: 'ruta_specs_actual',
    label: 'Ruta de la versión',
    description: `Ruta de la versión activa dentro del proyecto: ${SDD_SPECS_DIR}/${SDD_VERSIONS_DIR}/<versión>.md.`,
    value: () => specsVersionPath()
  }),
  Object.freeze({
    token: 'carpeta_specs_versiones',
    label: 'Carpeta de versiones',
    description: 'Carpeta que contiene todas las versiones de specs del proyecto.',
    value: () => `${SDD_SPECS_DIR}/${SDD_VERSIONS_DIR}`
  }),
  Object.freeze({
    token: 'archivo_specs_completo',
    label: 'Archivo de specs completo',
    description: 'Fuente de verdad con todos los requisitos y sus estados.',
    value: () => `${SDD_SPECS_DIR}/${SDD_FULL_FILE}`
  }),
  Object.freeze({
    token: 'archivo_bbdd',
    label: 'Archivo de BBDD',
    description: 'Documento S.D.D. con las tablas de base de datos.',
    value: () => `${SDD_SPECS_DIR}/${SDD_DATABASE_FILE}`
  }),
  Object.freeze({
    token: 'carpeta_recursos_specs',
    label: 'Carpeta de recursos',
    description: 'Carpeta con los archivos de referencia de los specs.',
    value: () => `${SDD_SPECS_DIR}/${SDD_RESOURCES_DIR}`
  }),
  Object.freeze({
    token: 'nombre_proyecto',
    label: 'Proyecto S.D.D.',
    description: 'Nombre del proyecto S.D.D. cargado en la aplicación.',
    value: () => text(sddProject()?.name, 200)
  }),
  Object.freeze({
    token: 'ruta_proyecto',
    label: 'Ruta del proyecto',
    description: 'Ruta absoluta del proyecto S.D.D. cargado.',
    value: () => text(sddProject()?.path, 500).replace(/\\/g, '/')
  })
]);

// Lista de variables globales con su valor actual ya resuelto.
export function getPromptGlobalVariables() {
  return GLOBAL_VARIABLE_DEFINITIONS.map(variableEntry);
}

// Atajo token -> valor. Las variables sin valor disponible valen cadena vacía.
export function getPromptGlobalVariableValues() {
  return getPromptGlobalVariables().reduce((values, variable) => {
    values[variable.tokenName] = variable.value;
    return values;
  }, {});
}

function globalVariableDefinition(name) {
  const key = text(name, 120);
  if (!key || !TOKEN_NAME_PATTERN.test(key)) return null;
  return GLOBAL_VARIABLE_DEFINITIONS.find((item) => item.token.toLowerCase() === key.toLowerCase()) || null;
}

// Valor de una variable global; '' si el nombre no existe o no tiene valor.
export function resolvePromptGlobalVariable(name) {
  const definition = globalVariableDefinition(name);
  return definition ? String(definition.value() ?? '') : '';
}

// ¿El nombre corresponde a una variable global registrada? (aunque no tenga valor).
export function isPromptGlobalVariable(name) {
  return Boolean(globalVariableDefinition(name));
}

// Tokens del contenido que corresponden a variables globales (para avisar en la interfaz).
export function findPromptGlobalTokens(content) {
  const found = new Set();
  String(content ?? '').replace(/\[([A-Za-z0-9_]+)\]/g, (match, name) => {
    if (GLOBAL_VARIABLE_DEFINITIONS.some((item) => item.token.toLowerCase() === name.toLowerCase())) found.add(match);
    return match;
  });
  return [...found];
}
