import { formatNumber } from './charts.js';
import { fitModels, fitTrace } from './plot-fit.js';
import { renderSurfacePlot } from './surface-plot.js';

const el = id => document.getElementById(id);
const sweepDefaults = {
  array: 'rotation', uv: 'concentration', pl: 'concentration', trpl: 'lifetime', raman: 'focus',
  ftir: 'mirrorTravel', ellipsometry: 'thickness', ta: 'delay', thz: 'thickness',
};
const defaultFit = { trpl: 'exponential', ellipsometry: 'linear' };
const csv = value => value == null ? '' : '"' + String(value).replaceAll('"', '""') + '"';
const isNumber = Number.isFinite;
const unit = label => /\(([^()]*)\)\s*$/.exec(label ?? '')?.[1] ?? '';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

function updateOptions(select, pairs, value) {
  const key = JSON.stringify(pairs);
  if (select.dataset.list !== key) {
    select.replaceChildren(...pairs.map(([id, label]) => new Option(label, id)));
    select.dataset.list = key;
  }
  select.value = value ?? '';
}

function rankedSignal(series) {
  let best = 0;
  let score = -Infinity;
  series.forEach((entry, index) => {
    if (entry.memory || entry.measured || entry.x?.length < 3) return;
    const name = entry.name ?? '';
    const rank = (/^sample$|^pump on$/i.test(name) ? 10 : 0)
      - (/reference|background|(^|\b)IRF\b|reconvolution fit|delay position/i.test(name) ? 5 : 0) - 0.01 * index;
    if (rank > score) { score = rank; best = index; }
  });
  return best;
}

function tracePoints(trace) {
  const samples = new Map();
  for (let i = 0; i < (trace?.x?.length ?? 0); i++) {
    if (isNumber(trace.x[i])) samples.set(trace.x[i], isNumber(trace.y?.[i]) ? trace.y[i] : null);
  }
  return [...samples].sort(([a], [b]) => a - b);
}

export function projectTrace(trace, grid) {
  const points = tracePoints(trace);
  let low = 0;
  return grid.map(x => {
    while (low + 1 < points.length && points[low + 1][0] <= x) low++;
    const a = points[low];
    const b = points[low + 1];
    if (!a || x < a[0]) return null;
    if (x === a[0]) return a[1];
    if (!b || !isNumber(a[1]) || !isNumber(b[1])) return null;
    return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
  });
}

function sweepable(context) {
  return context.controls.filter(control => control.type === 'range' &&
    (!control.when || context.state.settings[control.when.key] === control.when.value));
}

function axisName(control) {
  return control.label + (control.unit ? ' (' + control.unit + ')' : '');
}

function pointRange(entry) {
  const valid = tracePoints(entry).filter(([, y]) => isNumber(y));
  return [valid[0]?.[0], valid.at(-1)?.[0]];
}

export function createPlotAnalysis({ repaint, exportFile, reference, calculate }) {
  let fitContext, mapContext, job, surface, displayedSurface;
  updateOptions(el('fit-model'), Object.entries(fitModels), 'gaussian');

  function fitState(context) {
    const { state, chartIndex, chart, id } = context;
    const key = JSON.stringify([chartIndex, chart?.xLabel, chart?.yLabel]);
    if (state.fitPanel?.key !== key) {
      state.fitPanel = {
        key, series: rankedSignal(chart?.series ?? []),
        model: defaultFit[id] ?? 'gaussian', min: '', max: '', output: null, error: '',
      };
    }
    return state.fitPanel;
  }

  function fitInputs() {
    if (!fitContext) return;
    const fit = fitState(fitContext);
    fit.series = Number(el('fit-trace').value);
    fit.model = el('fit-model').value;
    fit.min = el('fit-min').value;
    fit.max = el('fit-max').value;
    fit.output = null;
    fit.error = '';
  }

  function syncFitCursors() {
    const { chart, state } = fitContext ?? {};
    const pins = chart && state.cursors.get(JSON.stringify([chart.title, chart.xLabel, chart.yLabel]));
    el('fit-cursors').disabled = !pins?.a || !pins?.b || pins.a.x === pins.b.x;
  }

  function renderFit(context) {
    fitContext = context;
    const { chart, state } = context;
    const fit = fitState(context);
    const series = chart?.series ?? [];
    if (!series[fit.series]) fit.series = rankedSignal(series);
    const entry = series[fit.series];
    updateOptions(el('fit-trace'), series.map((line, i) => [String(i), line.name ?? 'Trace ' + (i + 1)]), String(fit.series));
    el('fit-model').value = fit.model;
    const [low, high] = pointRange(entry);
    for (const [id, value, edge] of [['fit-min', fit.min, low], ['fit-max', fit.max, high]]) {
      const input = el(id);
      if (document.activeElement !== input) input.value = value;
      input.placeholder = isNumber(edge) ? formatNumber(edge, 5) : '';
      input.setAttribute('aria-label', (id.endsWith('min') ? 'Lower' : 'Upper') + ' fit limit' + (chart?.xLabel ? ' · ' + chart.xLabel : ''));
    }
    syncFitCursors();
    el('fit-run').disabled = !isNumber(low) || low === high;
    const result = fit.output?.x === entry?.x && fit.output?.y === entry?.y ? fit.output?.result : null;
    const status = el('fit-status');
    const xUnit = unit(chart?.xLabel);
    const yUnit = unit(chart?.yLabel);
    status.textContent = fit.error || (result
      ? (result.converged ? 'Fit converged' : 'Fit did not converge') + ' · n=' + result.count +
        ' · RMSE ' + formatNumber(result.rmse, 5) + (yUnit ? ' ' + yUnit : '') +
        (isNumber(result.r2) ? ' · R² ' + formatNumber(result.r2, 5) : '') +
        (result.warning ? ' · ' + result.warning : '')
      : fit.output ? 'Trace changed. Run the fit again.' : entry ? 'Set a range or leave both limits blank for the full trace.' : 'No line trace available.');
    status.dataset.error = String(Boolean(fit.error || (result && !result.converged)));
    el('fit-parameters').replaceChildren(...(result?.parameters ?? []).map(param => {
      const field = document.createElement('span');
      const value = document.createElement('b');
      const u = param.unit === 'x' ? xUnit : param.unit === 'y' ? yUnit
        : param.unit === 'y/x' && yUnit && xUnit ? yUnit + '/' + xUnit : '';
      value.textContent = formatNumber(param.value, 6) + (u ? ' ' + u : '');
      field.append(param.name + ' ', value);
      return field;
    }));
    if (!chart) return [];
    if (!result) return [chart];
    return [
      { ...chart, series: [...series, { ...result.curve, name: fitModels[fit.model] + ' fit', color: '#a12728', dash: '6 3' }] },
      { title: 'Trace fit residuals', xLabel: chart.xLabel, yLabel: yUnit ? 'Data − fit (' + yUnit + ')' : 'Data − fit',
        series: [{ ...result.residual, name: 'Residual', color: '#3f536b' }] },
    ];
  }

  for (const id of ['fit-trace', 'fit-model', 'fit-min', 'fit-max']) el(id).addEventListener('change', () => {
    fitInputs(); repaint();
  });
  el('fit-cursors').addEventListener('click', () => {
    const { chart, state } = fitContext;
    const pins = state.cursors.get(JSON.stringify([chart.title, chart.xLabel, chart.yLabel]));
    if (!pins?.a || !pins?.b) return;
    [el('fit-min').value, el('fit-max').value] = [pins.a.x, pins.b.x].sort((a, b) => a - b);
    fitInputs(); repaint();
  });
  el('fit-run').addEventListener('click', () => {
    fitInputs();
    const fit = fitState(fitContext);
    const entry = fitContext.chart?.series?.[fit.series];
    try {
      const result = fitTrace(entry, {
        model: fit.model, min: fit.min === '' ? undefined : Number(fit.min), max: fit.max === '' ? undefined : Number(fit.max),
      });
      fit.output = { result, x: entry.x, y: entry.y, title: fitContext.chart.title, name: entry.name,
        xLabel: fitContext.chart.xLabel, yLabel: fitContext.chart.yLabel };
    } catch (error) { fit.error = error.message; }
    repaint();
  });

  function currentFit(result, state) {
    const fit = state.fitPanel?.output;
    if (!fit || !result?.charts?.some(chart => chart.series?.some(line => line.x === fit.x && line.y === fit.y)) &&
        !state.memory?.charts.some(chart => chart.series?.some(line => line.x === fit.x && line.y === fit.y)) &&
        !(state.measurement?.x === fit.x && state.measurement?.y === fit.y)) return null;
    return fit;
  }

  function mapConfig(context) {
    const { state, id } = context;
    const axes = sweepable(context);
    const def = axes.find(control => control.key === sweepDefaults[id]) ?? axes[0];
    const control = axes.find(control => control.key === state.mapSettings?.key) ?? def;
    if (control && state.mapSettings?.key !== control.key) {
      state.mapSettings = { key: control.key, min: control.min, max: control.max, steps: 13 };
    }
    return { axes, control, values: state.mapSettings };
  }

  function mapRecord(context) {
    if (context.baseChart?.heatmap) {
      if (context.state.nativeSurface?.chart !== context.baseChart) {
        const { heatmap, xLabel, yLabel, title } = context.baseChart;
        context.state.nativeSurface = { chart: context.baseChart,
          data: { ...heatmap, xLabel, yLabel, zLabel: 'ΔA (mOD)', title } };
      }
      return context.state.nativeSurface;
    }
    return context.state.surface?.index === context.chartIndex ? context.state.surface : null;
  }

  function renderMap(context) {
    mapContext = context;
    const { control, axes, values } = mapConfig(context);
    const native = Boolean(context.baseChart?.heatmap);
    const active = Boolean(job);
    el('map-controls').hidden = native || !control;
    el('map-run').disabled = active || context.state.mode !== 'sample' || !context.baseChart?.series?.length;
    el('map-stop').hidden = !active;
    updateOptions(el('map-axis'), axes.map(item => [item.key, axisName(item)]), control?.key);
    if (control && values) {
      for (const [key, id] of [['min', 'map-min'], ['max', 'map-max'], ['steps', 'map-steps']]) {
        const input = el(id);
        if (key !== 'steps') { input.min = control.min; input.max = control.max; }
        if (document.activeElement !== input) input.value = values[key];
      }
    }
    const record = mapRecord(context);
    const data = record?.data;
    const host = el('surface-plot');
    host.hidden = !data;
    el('map-csv').disabled = !data || active;
    if (data && displayedSurface !== data) {
      if (surface) surface.update(data);
      else surface = renderSurfacePlot(host, data);
      displayedSurface = data;
    }
    const sameResult = record?.result === context.result && record?.key === values?.key &&
      record?.data?.y.length === Number(values?.steps) && record?.data?.y[0] === Number(values?.min) &&
      record?.data?.y.at(-1) === Number(values?.max);
    const status = el('map-status');
    status.textContent = active ? 'Sweep ' + job.done + ' / ' + job.total :
      native ? 'Wavelength–delay surface from the current ΔA grid.' :
      context.state.mapMessage || (record ? (sameResult ? data.y.length + ' settings · ' + record.trace : 'Previous sweep · run again for the current settings.') :
        context.state.mode !== 'sample' ? 'Switch to a sample measurement to run a sweep.' :
        'Choose a setting and run a sweep of the selected trace.');
  }

  function stopMap(message) {
    if (!job) return;
    const stopped = job;
    job = null;
    if (message) {
      stopped.context.state.mapMessage = message;
      if (mapContext?.state === stopped.context.state) renderMap(mapContext);
    }
  }

  el('map-stop').addEventListener('click', () => stopMap('Sweep stopped.'));
  el('map-axis').addEventListener('change', event => {
    if (!mapContext) return;
    const axis = sweepable(mapContext).find(control => control.key === event.target.value);
    if (!axis) return;
    stopMap();
    mapContext.state.mapSettings = { key: axis.key, min: axis.min, max: axis.max, steps: 13 };
    mapContext.state.mapMessage = '';
    renderMap(mapContext);
  });
  for (const [id, key] of [['map-min', 'min'], ['map-max', 'max'], ['map-steps', 'steps']]) el(id).addEventListener('change', event => {
    if (mapContext?.state.mapSettings) {
      stopMap();
      mapContext.state.mapSettings[key] = event.target.value;
      renderMap(mapContext);
    }
  });

  el('map-run').addEventListener('click', async () => {
    const context = mapContext;
    if (!context) return;
    const { control } = mapConfig(context);
    if (job || !control || context.state.mode !== 'sample') return;
    const { state, id, baseChart, chartIndex } = context;
    const raw = ['map-min', 'map-max', 'map-steps'].map(input => el(input).valueAsNumber);
    const [min, max, steps] = raw;
    if (!raw.every(isNumber) || min >= max || min < control.min || max > control.max || !Number.isInteger(steps) || steps < 5 || steps > 31) {
      state.mapMessage = 'Enter an increasing range within ' + control.min + '–' + control.max + ' and 5–31 steps.';
      renderMap(context);
      return;
    }
    const index = rankedSignal(baseChart?.series ?? []);
    const entry = baseChart?.series?.[index];
    const x = tracePoints(entry).map(([value]) => value);
    if (x.length < 2) {
      state.mapMessage = 'The selected graph has no sweepable trace.';
      renderMap(context);
      return;
    }
    state.mapSettings = { key: control.key, min, max, steps };
    state.mapMessage = '';
    const marker = { context, total: steps, done: 0 };
    job = marker;
    const settings = structuredClone(state.settings);
    const layout = structuredClone(state.layout);
    const dark = state.dark;
    const seed = state.seed;
    const y = Array.from({ length: steps }, (_, i) => i === steps - 1 ? max : min + (max - min) * i / (steps - 1));
    const z = [];
    renderMap(context);
    try {
      const ref = reference(state);
      for (const value of y) {
        await tick();
        if (job !== marker) return;
        const result = calculate(id, { ...settings, [control.key]: value }, layout, seed, ref, dark);
        const chart = result.charts?.[chartIndex];
        const compatible = chart?.xLabel === baseChart.xLabel && chart?.yLabel === baseChart.yLabel;
        const trace = compatible && (chart.series?.find(line => line.name === entry.name) ?? chart.series?.[index]);
        z.push(projectTrace(trace, x));
        marker.done++;
        if (mapContext?.state === state && mapContext.chartIndex === chartIndex) el('map-status').textContent = 'Sweep ' + marker.done + ' / ' + steps;
      }
      if (!z.some(row => row.some(isNumber))) throw new Error('No finite values were returned for this sweep.');
      state.surface = {
        index: chartIndex, key: control.key, result: context.result, trace: entry.name,
        data: { x, y, z, xLabel: baseChart.xLabel, yLabel: axisName(control), zLabel: baseChart.yLabel,
          title: baseChart.title + ' vs ' + control.label.toLowerCase() },
      };
    } catch (error) { state.mapMessage = error.message; }
    finally {
      if (job === marker) {
        job = null;
        if (mapContext?.state === state && state.display === 'map') renderMap(mapContext);
      }
    }
  });

  el('map-csv').addEventListener('click', () => {
    const data = mapContext && mapRecord(mapContext)?.data;
    if (!data) return;
    const rows = [[data.xLabel, data.yLabel, data.zLabel].map(csv).join(',')];
    for (let i = 0; i < data.y.length; i++) for (let j = 0; j < data.x.length; j++) {
      const z = data.z[i]?.[j];
      rows.push([data.x[j], data.y[i], isNumber(z) ? z : null].map(csv).join(','));
    }
    exportFile('spectral-bench-' + mapContext.id + '-map.csv', '\uFEFF' + rows.join('\r\n'));
  });

  return { renderFit, currentFit, syncFitCursors, renderMap, stopMap };
}
