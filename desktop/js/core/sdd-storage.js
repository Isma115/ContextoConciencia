// Preferencias de S.D.D. guardadas en el almacenamiento local del renderer.
//
// Se centralizan aquí porque las usan tanto la vista de S.D.D. como las variables
// globales de los prompts (versión de specs activa y ruta del proyecto), que deben
// poder resolverse aunque el proyecto todavía no se haya cargado en la sesión.

export const SDD_PROJECT_PATH_STORAGE_KEY = 'nexusdata.sdd-project-path.v1';
export const SDD_LAST_PROJECT_STORAGE_KEY = 'nexusdata.sdd-last-project';
export const SDD_ACTIVE_VERSION_STORAGE_KEY = 'nexusdata.sdd-active-version.v1';

function localStore() {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function readStoredSddProjectPath() {
  try {
    return localStore()?.getItem(SDD_PROJECT_PATH_STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

export function persistStoredSddProjectPath(projectPath) {
  try {
    const store = localStore();
    if (!store) return;
    if (projectPath) store.setItem(SDD_PROJECT_PATH_STORAGE_KEY, projectPath);
    else store.removeItem(SDD_PROJECT_PATH_STORAGE_KEY);
  } catch {
    // El proyecto sigue disponible durante la sesión aunque no se pueda guardar la ruta.
  }
}

export function readStoredSddActiveVersion(projectPath) {
  try {
    if (!projectPath) return '';
    return String(localStore()?.getItem(`${SDD_ACTIVE_VERSION_STORAGE_KEY}:${projectPath}`) || '').trim();
  } catch {
    return '';
  }
}

export function persistStoredSddActiveVersion(projectPath, version) {
  try {
    if (!projectPath) return;
    const store = localStore();
    if (!store) return;
    const key = `${SDD_ACTIVE_VERSION_STORAGE_KEY}:${projectPath}`;
    if (version) store.setItem(key, version);
    else store.removeItem(key);
  } catch {
    // La versión sigue activa durante la sesión aunque no se pueda persistir.
  }
}

export function persistStoredSddLastProject(payload) {
  try {
    const store = localStore();
    if (!store) return;
    if (payload) store.setItem(SDD_LAST_PROJECT_STORAGE_KEY, JSON.stringify(payload));
    else store.removeItem(SDD_LAST_PROJECT_STORAGE_KEY);
  } catch {
    // Si el almacenamiento local no está disponible, se conserva el fichero del proceso principal.
  }
}

export function readStoredSddLastProject() {
  try {
    const stored = JSON.parse(localStore()?.getItem(SDD_LAST_PROJECT_STORAGE_KEY) || 'null');
    return stored && typeof stored.path === 'string' && stored.path.trim() ? stored : null;
  } catch {
    return null;
  }
}
