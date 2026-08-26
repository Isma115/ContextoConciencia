const PALETTE_STORAGE_KEY = 'nexusdata.palette.v1';
export const DEFAULT_PALETTE = 'midnight';

export const PALETTES = Object.freeze({
  midnight: Object.freeze({ label: 'Noche azul' }),
  ocean: Object.freeze({ label: 'Océano' }),
  forest: Object.freeze({ label: 'Bosque' }),
  plum: Object.freeze({ label: 'Ciruela' })
});

function isPalette(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(PALETTES, value);
}

function storedPalette() {
  try {
    return typeof window !== 'undefined' && window.localStorage
      ? window.localStorage.getItem(PALETTE_STORAGE_KEY)
      : null;
  } catch {
    return null;
  }
}

export function normalisePalette(value) {
  return isPalette(value) ? value : DEFAULT_PALETTE;
}

export function currentPalette() {
  return normalisePalette(typeof document !== 'undefined' ? document.documentElement.dataset.palette : DEFAULT_PALETTE);
}

export function applyPalette(value) {
  const palette = normalisePalette(value);
  if (typeof document !== 'undefined') document.documentElement.dataset.palette = palette;
  return palette;
}

export function loadPalettePreference() {
  return applyPalette(storedPalette());
}

export function savePalettePreference(value) {
  const palette = applyPalette(value);
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(PALETTE_STORAGE_KEY, palette);
    }
  } catch {
    // La paleta sigue aplicada durante la sesión aunque el almacenamiento no esté disponible.
  }
  return palette;
}
