// Cálculo de la siguiente versión de specs a partir de las versiones existentes.
//
// Se usa en el selector de versión de S.D.D. para que la ventana de «Nueva
// versión» llegue rellena con la sugerencia (0.0.1 → 0.0.2). El módulo es puro
// para poder probarlo sin DOM.

function versionNames(versions) {
  if (!Array.isArray(versions)) return [];
  const seen = new Set();
  const names = [];
  versions.forEach((version) => {
    const name = String(version?.name ?? version ?? '').trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    names.push(name);
  });
  return names;
}

function compareVersionNames(left, right) {
  return String(left).localeCompare(String(right), 'es', { numeric: true, sensitivity: 'base' });
}

function highestVersionName(names) {
  return [...names].sort(compareVersionNames).at(-1) || '';
}

// Incrementa el último grupo numérico del nombre conservando prefijo, relleno
// de ceros y sufijo: 0.0.1 → 0.0.2, 1.9 → 1.10, v3 → v4, 1.0.0-rc2 → 1.0.0-rc3.
// Sin dígitos (por ejemplo «beta») se añade un contador: beta → beta-2.
export function bumpSddVersionName(name) {
  const value = String(name || '').trim();
  if (!value) return '';
  const match = /^(.*?)(\d+)(\D*)$/.exec(value);
  if (!match) return `${value}-2`;
  const [, head, digits, tail] = match;
  const next = String(Number(digits) + 1).padStart(digits.length, '0');
  return `${head}${next}${tail}`;
}

// Devuelve la versión que debería crearse después de `activeVersion`. La base es
// la versión activa cuando existe en el proyecto y, si no, la más alta. Si la
// sugerencia ya existe se sigue incrementando hasta encontrar un nombre libre.
export function nextSddVersionName(versions, activeVersion = '') {
  const names = versionNames(versions);
  const active = String(activeVersion || '').trim();
  const base = !names.length ? active : (names.includes(active) ? active : highestVersionName(names));
  if (!base) return '';
  const known = new Set(names.map((name) => name.toLocaleLowerCase()));
  let candidate = bumpSddVersionName(base);
  for (let guard = 0; candidate && known.has(candidate.toLocaleLowerCase()) && guard < 100; guard += 1) {
    candidate = bumpSddVersionName(candidate);
  }
  return candidate;
}
