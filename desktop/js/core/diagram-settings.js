const DIAGRAM_LINE_CONTRAST_STORAGE_KEY = 'nexusdata.diagram-line-contrast.v1';
const DIAGRAM_FONT_SIZE_STORAGE_KEY = 'nexusdata.diagram-font-size.v1';

export const DEFAULT_DIAGRAM_LINE_CONTRAST = 'normal';
export const DEFAULT_DIAGRAM_FONT_SIZE = 'normal';

export const DIAGRAM_LINE_CONTRASTS = Object.freeze({
  low: Object.freeze({ label: 'Bajo' }),
  normal: Object.freeze({ label: 'Medio' }),
  high: Object.freeze({ label: 'Intermedio' }),
  'very-high': Object.freeze({ label: 'Alto' })
});

export const DIAGRAM_FONT_SIZES = Object.freeze({
  small: Object.freeze({ label: 'Pequeña', scale: 0.9 }),
  normal: Object.freeze({ label: 'Normal', scale: 1 }),
  large: Object.freeze({ label: 'Grande', scale: 1.15 }),
  'very-large': Object.freeze({ label: 'Muy grande', scale: 1.3 })
});

function isDiagramLineContrast(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(DIAGRAM_LINE_CONTRASTS, value);
}

function isDiagramFontSize(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(DIAGRAM_FONT_SIZES, value);
}

function storedDiagramLineContrast() {
  try {
    return typeof window !== 'undefined' && window.localStorage
      ? window.localStorage.getItem(DIAGRAM_LINE_CONTRAST_STORAGE_KEY)
      : null;
  } catch {
    return null;
  }
}

function storedDiagramFontSize() {
  try {
    return typeof window !== 'undefined' && window.localStorage
      ? window.localStorage.getItem(DIAGRAM_FONT_SIZE_STORAGE_KEY)
      : null;
  } catch {
    return null;
  }
}

export function normaliseDiagramLineContrast(value) {
  return isDiagramLineContrast(value) ? value : DEFAULT_DIAGRAM_LINE_CONTRAST;
}

export function currentDiagramLineContrast() {
  return normaliseDiagramLineContrast(
    typeof document !== 'undefined'
      ? document.documentElement.dataset.diagramLineContrast
      : DEFAULT_DIAGRAM_LINE_CONTRAST
  );
}

export function applyDiagramLineContrast(value) {
  const contrast = normaliseDiagramLineContrast(value);
  if (typeof document !== 'undefined') document.documentElement.dataset.diagramLineContrast = contrast;
  return contrast;
}

export function loadDiagramLineContrast() {
  return applyDiagramLineContrast(storedDiagramLineContrast());
}

export function saveDiagramLineContrast(value) {
  const contrast = applyDiagramLineContrast(value);
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(DIAGRAM_LINE_CONTRAST_STORAGE_KEY, contrast);
    }
  } catch {
    // El ajuste sigue aplicado durante la sesión aunque el almacenamiento no esté disponible.
  }
  return contrast;
}

export function normaliseDiagramFontSize(value) {
  return isDiagramFontSize(value) ? value : DEFAULT_DIAGRAM_FONT_SIZE;
}

export function currentDiagramFontSize() {
  return normaliseDiagramFontSize(
    typeof document !== 'undefined'
      ? document.documentElement.dataset.diagramFontSize
      : DEFAULT_DIAGRAM_FONT_SIZE
  );
}

export function currentDiagramFontScale() {
  return DIAGRAM_FONT_SIZES[currentDiagramFontSize()].scale;
}

export function applyDiagramFontSize(value) {
  const fontSize = normaliseDiagramFontSize(value);
  if (typeof document !== 'undefined') document.documentElement.dataset.diagramFontSize = fontSize;
  return fontSize;
}

export function loadDiagramFontSize() {
  return applyDiagramFontSize(storedDiagramFontSize());
}

export function saveDiagramFontSize(value) {
  const fontSize = applyDiagramFontSize(value);
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(DIAGRAM_FONT_SIZE_STORAGE_KEY, fontSize);
    }
  } catch {
    // El ajuste sigue aplicado durante la sesión aunque el almacenamiento no esté disponible.
  }
  return fontSize;
}
