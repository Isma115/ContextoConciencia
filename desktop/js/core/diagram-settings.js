const DIAGRAM_LINE_CONTRAST_STORAGE_KEY = 'nexusdata.diagram-line-contrast.v1';

export const DEFAULT_DIAGRAM_LINE_CONTRAST = 'normal';

export const DIAGRAM_LINE_CONTRASTS = Object.freeze({
  low: Object.freeze({ label: 'Bajo' }),
  normal: Object.freeze({ label: 'Medio' }),
  high: Object.freeze({ label: 'Intermedio' }),
  'very-high': Object.freeze({ label: 'Alto' })
});

function isDiagramLineContrast(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(DIAGRAM_LINE_CONTRASTS, value);
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
