const PROMPT_STORE_KEY = 'nexusdata.prompt-library.v1';
const PROMPT_STORE_VERSION = 1;
const MAX_PROMPT_NAME_LENGTH = 120;
const MAX_PROMPT_CONTENT_LENGTH = 200000;

export const BUILTIN_PROMPT_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'new-diagram',
    name: 'Nuevo diagrama',
    description: 'Plantilla para pedir a un agente un diagrama de flujo del proyecto.',
    kind: 'template',
    variableHint: 'Conserva [FUNCIONALIDAD] para insertar lo que describas al generar el prompt.'
  }),
  Object.freeze({
    id: 'git-diff',
    name: 'Analizar diff de git',
    description: 'Prompt breve para revisar y describir los cambios del diff actual.',
    kind: 'static'
  }),
  Object.freeze({
    id: 'completed-specs',
    name: 'Generar specs.md completado',
    description: 'Prompt para documentar la implementación real en S.D.D.',
    kind: 'dynamic'
  }),
  Object.freeze({
    id: 'follow-specs',
    name: 'Trabajar siguiendo specs',
    description: 'Prompt para implementar los requisitos pendientes de S.D.D.',
    kind: 'dynamic'
  })
]);

const BUILTIN_PROMPT_IDS = new Set(BUILTIN_PROMPT_DEFINITIONS.map((prompt) => prompt.id));
let memoryStore = null;

function emptyStore() {
  return { version: PROMPT_STORE_VERSION, overrides: {}, custom: [] };
}

function normaliseText(value, maxLength, trim = false) {
  if (typeof value !== 'string') return '';
  const text = value.slice(0, maxLength);
  return trim ? text.trim() : text;
}

function normaliseCustomPrompt(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const id = normaliseText(value.id, 120, true);
  const name = normaliseText(value.name, MAX_PROMPT_NAME_LENGTH, true);
  const content = normaliseText(value.content, MAX_PROMPT_CONTENT_LENGTH);
  if (!/^custom-[a-z0-9-]+$/i.test(id) || !name || !content.trim()) return null;
  return {
    id,
    name,
    content,
    createdAt: normaliseText(value.createdAt, 40, true) || new Date().toISOString(),
    updatedAt: normaliseText(value.updatedAt, 40, true) || new Date().toISOString()
  };
}

function normaliseStore(value) {
  const store = emptyStore();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return store;
  if (value.overrides && typeof value.overrides === 'object' && !Array.isArray(value.overrides)) {
    for (const id of BUILTIN_PROMPT_IDS) {
      const content = normaliseText(value.overrides[id], MAX_PROMPT_CONTENT_LENGTH);
      if (content.trim()) store.overrides[id] = content;
    }
  }
  if (Array.isArray(value.custom)) {
    const ids = new Set();
    value.custom.forEach((item) => {
      const prompt = normaliseCustomPrompt(item);
      if (!prompt || ids.has(prompt.id)) return;
      ids.add(prompt.id);
      store.custom.push(prompt);
    });
  }
  return store;
}

function readStore() {
  if (memoryStore) return memoryStore;
  try {
    const raw = typeof window !== 'undefined' && window.localStorage
      ? window.localStorage.getItem(PROMPT_STORE_KEY)
      : null;
    memoryStore = normaliseStore(raw ? JSON.parse(raw) : null);
  } catch {
    memoryStore = emptyStore();
  }
  return memoryStore;
}

function writeStore(store) {
  memoryStore = normaliseStore(store);
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(PROMPT_STORE_KEY, JSON.stringify(memoryStore));
    }
  } catch {
    // Los prompts siguen disponibles en memoria aunque el almacenamiento falle.
  }
  return memoryStore;
}

function newPromptId() {
  const random = Math.random().toString(36).slice(2, 8);
  return `custom-${Date.now().toString(36)}-${random}`;
}

export function getPromptOverride(id) {
  return readStore().overrides[id] || null;
}

export function savePromptOverride(id, content) {
  if (!BUILTIN_PROMPT_IDS.has(id)) throw new Error('El prompt indicado no se puede personalizar');
  const value = normaliseText(content, MAX_PROMPT_CONTENT_LENGTH);
  if (!value.trim()) throw new Error('El prompt no puede estar vacío');
  const store = readStore();
  store.overrides[id] = value;
  writeStore(store);
  return value;
}

export function resetPromptOverride(id) {
  if (!BUILTIN_PROMPT_IDS.has(id)) return false;
  const store = readStore();
  const existed = Object.prototype.hasOwnProperty.call(store.overrides, id);
  delete store.overrides[id];
  writeStore(store);
  return existed;
}

export function listCustomPrompts() {
  return readStore().custom.map((prompt) => ({ ...prompt }));
}

export function saveCustomPrompt({ id, name, content } = {}) {
  const promptName = normaliseText(name, MAX_PROMPT_NAME_LENGTH, true);
  const promptContent = normaliseText(content, MAX_PROMPT_CONTENT_LENGTH);
  if (!promptName) throw new Error('Indica un nombre para el prompt');
  if (!promptContent.trim()) throw new Error('El prompt no puede estar vacío');
  const store = readStore();
  const existingIndex = store.custom.findIndex((prompt) => prompt.id === id);
  const now = new Date().toISOString();
  const prompt = {
    id: existingIndex >= 0 ? store.custom[existingIndex].id : newPromptId(),
    name: promptName,
    content: promptContent,
    createdAt: existingIndex >= 0 ? store.custom[existingIndex].createdAt : now,
    updatedAt: now
  };
  if (existingIndex >= 0) store.custom[existingIndex] = prompt;
  else store.custom.unshift(prompt);
  writeStore(store);
  return { ...prompt };
}

export function deleteCustomPrompt(id) {
  const store = readStore();
  const next = store.custom.filter((prompt) => prompt.id !== id);
  if (next.length === store.custom.length) return false;
  store.custom = next;
  writeStore(store);
  return true;
}

export function getCustomPrompt(id) {
  const prompt = readStore().custom.find((item) => item.id === id);
  return prompt ? { ...prompt } : null;
}

export function replacePromptVariables(content, variables = {}) {
  return String(content ?? '').replace(/\[([A-Z0-9_]+)\]/g, (token, name) => (
    Object.prototype.hasOwnProperty.call(variables, name) ? String(variables[name] ?? '') : token
  ));
}

export function promptMenuItems() {
  return listCustomPrompts().map(({ id, name }) => ({ id, name }));
}
