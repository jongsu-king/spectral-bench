import { fitModels } from './plot-fit.js';

const index = value => Number.isInteger(value) && value >= 0 && value < 128 ? value : 0;
const numberText = value => value === '' || value == null ? '' : Number.isFinite(Number(value)) && String(value).length <= 64 ? String(value) : '';
const key = value => typeof value === 'string' && value.length <= 1000 ? value : null;
const numeric = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') &&
  Number.isFinite(Number(value)) ? Number(value) : NaN;

function panel(value) {
  return value && key(value.key) !== null ? { key: value.key, series: index(value.series), min: numberText(value.min),
    max: numberText(value.max), output: null, error: '' } : null;
}

export function restoreAnalysisSettings(saved, controls = []) {
  const fitPanel = panel(saved?.fit);
  if (fitPanel) fitPanel.model = Object.hasOwn(fitModels, saved.fit.model) ? saved.fit.model : 'gaussian';
  const traceAnalysis = panel(saved?.statistics);
  if (traceAnalysis) Object.assign(traceAnalysis, {
    baseline: ['constant', 'linear'].includes(saved.statistics.baseline) ? saved.statistics.baseline : 'none',
    baselineValue: numberText(saved.statistics.baselineValue) || '0',
  });
  const map = saved?.map;
  const axis = controls.find(control => control.type === 'range' && control.key === map?.key);
  const low = numeric(map?.min), high = numeric(map?.max), steps = numeric(map?.steps);
  const mapSettings = axis && [low, high].every(Number.isFinite) && low < high &&
    low >= axis.min && high <= axis.max ? { key: axis.key, min: low, max: high,
      steps: Number.isInteger(steps) ? Math.max(5, Math.min(31, steps)) : 13 } : null;
  return { fitPanel, traceAnalysis, mapSettings };
}

/** Analysis inputs persist; fitted arrays are recalculated from the restored measurement. */
export function serializeAnalysisSettings(state) {
  const inputs = value => value ? { key: value.key, series: value.series, min: value.min, max: value.max } : null;
  return {
    fit: state.fitPanel ? { ...inputs(state.fitPanel), model: state.fitPanel.model } : null,
    statistics: state.traceAnalysis ? { ...inputs(state.traceAnalysis), baseline: state.traceAnalysis.baseline,
      baselineValue: state.traceAnalysis.baselineValue } : null,
    map: state.mapSettings ? { key: state.mapSettings.key, min: numeric(state.mapSettings.min),
      max: numeric(state.mapSettings.max), steps: numeric(state.mapSettings.steps) } : null,
  };
}

export function restorePlotCursors(saved) {
  const cursors = new Map();
  if (!Array.isArray(saved)) return cursors;
  const point = value => value && Number.isFinite(value.x) && (value.y == null || Number.isFinite(value.y))
    ? { x: value.x, y: value.y ?? undefined } : null;
  for (const item of saved.slice(0, 50)) {
    if (!Array.isArray(item) || item.length !== 2 || key(item[0]) === null || !item[1]) continue;
    const a = point(item[1].a), b = point(item[1].b);
    if (a || b) cursors.set(item[0], { a, b });
  }
  return cursors;
}
