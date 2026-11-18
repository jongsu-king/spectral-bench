import { formatNumber, renderCharts } from './charts.js';
import { renderSurfacePlot } from './surface-plot.js';

export const alignmentMapAxes = Object.freeze({
  x: { axis: 'position', coordinate: 0, label: 'X', unit: 'mm', limit: 2500, range: 1500 },
  y: { axis: 'position', coordinate: 1, label: 'Y', unit: 'mm', limit: 2500, range: 1500 },
  z: { axis: 'position', coordinate: 2, label: 'Z', unit: 'mm', limit: 2500, range: 1500 },
  rx: { axis: 'rotation', coordinate: 0, label: 'Rx', unit: '°', limit: 360, range: 360 },
  ry: { axis: 'rotation', coordinate: 1, label: 'Ry', unit: '°', limit: 360, range: 360 },
  rz: { axis: 'rotation', coordinate: 2, label: 'Rz', unit: '°', limit: 360, range: 360 },
});
export const alignmentMapMetrics = Object.freeze({
  power: { label: 'Detector power', unit: 'mW' },
  transfer: { label: 'Optical transfer', unit: '%' },
  count: { label: 'Detected rays', unit: '' },
  rms: { label: 'RMS spot radius', unit: 'mm' },
});

const readyMessage = 'Both offsets are relative to the current pose. The live layout stays fixed while the map is traced.';
const metricLabel = key => alignmentMapMetrics[key].label + (alignmentMapMetrics[key].unit ? ' (' + alignmentMapMetrics[key].unit + ')' : '');
const axisLabel = spec => spec.label + ' offset (' + spec.unit + ')';
const finite = value => Number.isFinite(value) ? value : NaN;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

export function alignmentMapGrid(optic, settings) {
  if (!optic || !Array.isArray(settings) || settings.length !== 2 || settings.some(setting => !setting || typeof setting !== 'object') || settings[0].key === settings[1].key) {
    throw new Error('Select one enabled optic and two distinct axes.');
  }
  return settings.map(setting => {
    const spec = alignmentMapAxes[setting.key];
    const { min, max, steps } = setting;
    const origin = spec && optic[spec.axis]?.[spec.coordinate];
    if (!spec || ![min, max, origin].every(Number.isFinite) || !(min < max) ||
        Math.abs(min) > spec.range || Math.abs(max) > spec.range ||
        Math.abs(origin + min) > spec.limit || Math.abs(origin + max) > spec.limit ||
        !Number.isInteger(steps) || steps < 3 || steps > 15) {
      throw new Error('Use 3–15 points per axis with increasing offsets. Position offsets must stay within ±1500 mm and final positions within ±2500 mm; rotations within ±360°.');
    }
    return { ...spec, key: setting.key, origin, min, max, steps,
      values: Array.from({ length: steps }, (_, index) => min + (max - min) * index / (steps - 1)) };
  });
}

export function alignmentMapReadings(traced, detectorId) {
  const detector = traced?.detectors?.find(candidate => candidate.id === detectorId);
  const power = finite(detector?.power);
  let rms = NaN;
  if (power > 0 && detector?.centroid?.length >= 2 && detector.centroid.slice(0, 2).every(Number.isFinite)) {
    const [u, v] = detector.centroid;
    let moment = 0, samples = 0;
    for (const hit of detector.hits ?? []) {
      if (![hit.u, hit.v, hit.power].every(Number.isFinite) || hit.power < 0) continue;
      moment += hit.power * ((hit.u - u) ** 2 + (hit.v - v) ** 2);
      samples++;
    }
    if (samples) rms = Math.sqrt(moment / power);
  }
  return { transfer: finite(100 * traced?.coupling), power, count: finite(detector?.count), rms };
}

export function bestAlignmentMapPoint(rows, metric = 'power') {
  if (!Object.hasOwn(alignmentMapMetrics, metric)) return -1;
  let best = -1;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (!Number.isFinite(row[metric]) || (metric === 'rms' && !(row.power > 0 && row.count > 0))) continue;
    const distance = candidate => Math.hypot(candidate.xNormalized ?? candidate.xOffset, candidate.yNormalized ?? candidate.yOffset);
    const difference = best < 0 ? 1 : (row[metric] - rows[best][metric]) * (metric === 'rms' ? -1 : 1);
    if (best < 0 || difference > 0 || (difference === 0 && distance(row) < distance(rows[best]))) best = index;
  }
  return best;
}

export function alignmentMapSurface(result, metric) {
  if (!Object.hasOwn(alignmentMapMetrics, metric)) throw new Error('Select a map metric.');
  const [first, second] = result.axes;
  return { title: result.partName + ' · ' + metricLabel(metric), xLabel: axisLabel(first), yLabel: axisLabel(second),
    zLabel: metricLabel(metric), x: [...first.values], y: [...second.values],
    z: second.values.map((_, row) => first.values.map((_, column) => {
      const value = result.rows[row * first.values.length + column]?.[metric];
      return Number.isFinite(value) ? value : null;
    })) };
}

function csvCell(value) {
  if (value == null || (typeof value === 'number' && !Number.isFinite(value))) return '';
  return '"' + String(value).replaceAll('"', '""') + '"';
}

export function alignmentMapCsv(result) {
  const first = result.axes[0], second = result.axes[1];
  const records = [['instrument', 'acquisition_mode', 'optic_id', 'optic', 'detector_id', 'detector',
    'axis_1', 'offset_1', 'offset_1_unit', 'axis_2', 'offset_2', 'offset_2_unit',
    'origin_x_mm', 'origin_y_mm', 'origin_z_mm', 'origin_rx_deg', 'origin_ry_deg', 'origin_rz_deg',
    'optical_transfer_percent', 'detector_power_mw', 'detected_rays', 'rms_spot_mm']];
  for (const row of result.rows) records.push([result.station, result.mode, result.partId, result.partName,
    result.detectorId, result.detectorName, first.label, row.xOffset, first.unit, second.label, row.yOffset, second.unit,
    ...result.origin.position, ...result.origin.rotation, row.transfer, row.power, row.count, row.rms]);
  return '\uFEFF' + records.map(row => row.map(csvCell).join(',')).join('\r\n');
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createAlignmentMap({ host, snapshot, trace, apply, exportFile, notify }) {
  if (!host) throw new Error('The alignment map host is unavailable.');
  const prefix = host.id || 'alignment-map';
  const named = (node, name) => { node.id = prefix + '-' + name; return node; };
  const details = element('details', 'alignment-map');
  details.append(element('summary', '', '2-axis alignment map'));
  const controls = element('div', 'alignment-map-controls');
  const field = (text, input, container = controls) => {
    const label = element('label', '', text);
    label.append(input);
    container.append(label);
    return input;
  };
  const optionSelect = (name, entries) => {
    const select = named(element('select'), name);
    select.replaceChildren(...entries.map(([value, label]) => new Option(label, value)));
    return select;
  };
  const part = field('Optic', optionSelect('part', []));
  const detector = field('Detector', optionSelect('detector', []));
  const axisFields = [0, 1].map(index => {
    const row = element('div', 'alignment-map-axis');
    const axis = field('Axis ' + (index + 1), optionSelect('axis-' + index,
      Object.entries(alignmentMapAxes).map(([key, value]) => [key, value.axis === 'position' ? 'Move ' + value.label : 'Rotate ' + value.label.slice(1)])), row);
    axis.value = index ? 'y' : 'x';
    const number = (name, value, min, max, step = 'any') => {
      const input = named(element('input'), name + '-' + index);
      input.type = 'number'; input.value = value; input.step = step;
      if (min !== undefined) input.min = min;
      if (max !== undefined) input.max = max;
      return input;
    };
    const min = field('From (mm)', number('min', -20), row);
    const max = field('To (mm)', number('max', 20), row);
    const steps = field('Points', number('steps', 7, 3, 15, 1), row);
    controls.append(row);
    return { axis, min, max, steps, unit: 'mm' };
  });
  const commands = element('div', 'alignment-map-commands');
  const button = (name, text, parent = commands) => {
    const node = named(element('button', 'button', text), name); node.type = 'button'; parent.append(node); return node;
  };
  const runButton = button('run', 'Run map'); runButton.classList.add('primary-button');
  const cancelButton = button('cancel', 'Cancel');
  const size = named(element('output', 'alignment-map-size'), 'size'); commands.append(size);
  controls.append(commands);
  const status = named(element('output', 'alignment-map-status', readyMessage), 'status'); status.setAttribute('aria-live', 'polite');
  const results = named(element('div', 'alignment-map-results'), 'results'); results.hidden = true;
  const resultTools = element('div', 'alignment-map-commands');
  const metric = field('Plot', optionSelect('metric', Object.entries(alignmentMapMetrics).map(([key, value]) => [key, value.label])), resultTools);
  const display = field('View', optionSelect('display', [['heatmap', 'Heatmap'], ['surface', '3D surface'], ['table', 'Table']]), resultTools);
  const powerButton = button('best-power', 'Highest power', resultTools);
  const rmsButton = button('best-rms', 'Minimum RMS', resultTools);
  const applyButton = button('apply', 'Apply offsets', resultTools);
  const exportButton = button('export', 'Export map CSV', resultTools);
  const selection = named(element('output', 'alignment-map-selection'), 'selection'); selection.setAttribute('aria-live', 'polite');
  const plotHost = named(element('div', 'plots alignment-map-plot'), 'plot');
  const surfaceHost = named(element('div', 'alignment-map-surface'), 'surface'); surfaceHost.hidden = true;
  const tableHost = element('div', 'alignment-map-table'); tableHost.hidden = true;
  const table = element('table'); table.setAttribute('aria-label', 'Sampled two-axis optical alignment results');
  const header = element('thead'), heading = element('tr');
  const xHeading = element('th'), yHeading = element('th');
  for (const cell of [xHeading, yHeading, ...['Transfer (%)', 'Power (mW)', 'Hits', 'RMS (mm)'].map(label => element('th', '', label))]) {
    cell.scope = 'col'; heading.append(cell);
  }
  const rowsHost = named(element('tbody'), 'rows'); header.append(heading); table.append(header, rowsHost); tableHost.append(table);
  results.append(resultTools, selection, plotHost, surfaceHost, tableHost,
    element('p', 'alignment-map-hint', 'Click the heatmap or a table row to select a sampled pose. Highest power and Minimum RMS select grid samples; they do not estimate a continuous optimum.'));
  details.append(controls, status, results);
  host.replaceChildren(details);

  let context, job, result, plot, surface;
  let plotCursors = new Map();
  let selected = -1;
  let tableRows = [];

  function posePair(record, point) {
    return record.axes.map((axis, index) => ({ partId: record.partId, axis: axis.axis, coordinate: axis.coordinate,
      offset: index ? point.yOffset : point.xOffset }));
  }

  function updateControls() {
    const busy = Boolean(job);
    const available = Boolean(context?.trace && context.mode !== 'dark' && part.value && detector.value);
    for (const input of [part, detector, ...axisFields.flatMap(row => [row.axis, row.min, row.max, row.steps])]) input.disabled = busy || !context?.trace;
    runButton.disabled = busy || !available;
    cancelButton.disabled = !busy;
    const point = result?.rows[selected];
    applyButton.disabled = busy || !point || !(point.xOffset || point.yOffset);
    exportButton.disabled = busy || !result;
    powerButton.disabled = busy || !result || bestAlignmentMapPoint(result.rows, 'power') < 0;
    rmsButton.disabled = busy || !result || bestAlignmentMapPoint(result.rows, 'rms') < 0;
    metric.disabled = busy || !result;
    display.disabled = busy || !result;
    const counts = axisFields.map(row => row.steps.valueAsNumber);
    size.textContent = counts.every(Number.isInteger) && counts.every(count => count >= 3 && count <= 15)
      ? counts[0] + ' × ' + counts[1] + ' = ' + counts[0] * counts[1] + ' positions' : '3–15 points per axis; at most 225 positions';
    for (let index = 0; index < axisFields.length; index++) {
      const other = axisFields[1 - index].axis.value;
      for (const option of axisFields[index].axis.options) option.disabled = option.value === other;
    }
    results.classList.toggle('is-tracing', busy);
  }

  function clearResults() {
    plot?.disconnect(); plot = undefined;
    surface?.disconnect(); surface = undefined;
    result = undefined; selected = -1; tableRows = [];
    plotHost.replaceChildren(); surfaceHost.replaceChildren(); rowsHost.replaceChildren();
    selection.textContent = ''; results.hidden = true;
    updateControls();
  }

  function cancel(message = 'Map cancelled. No offsets were applied.') {
    if (!job) return;
    job = undefined;
    status.textContent = message;
    updateControls();
  }

  function options(select, entries, preferred, empty) {
    const signature = JSON.stringify(entries.map(entry => [entry.id, entry.name]));
    if (select.dataset.options !== signature) {
      select.replaceChildren(...entries.map(entry => new Option(entry.name, entry.id)));
      if (!entries.length) select.add(new Option(empty, ''));
      select.dataset.options = signature;
    }
    select.value = entries.some(entry => entry.id === preferred) ? preferred : entries[0]?.id ?? '';
  }

  function update(next) {
    const stationChanged = context?.station !== next?.station;
    const traceChanged = context?.trace !== next?.trace || context?.mode !== next?.mode;
    const partChanged = context?.partId !== next?.partId;
    if (!stationChanged && !traceChanged && !partChanged) return;
    const previousPart = part.value, previousDetector = detector.value;
    context = next;
    const optics = next?.trace?.scene.parts.filter(optic => optic.enabled !== false) ?? [];
    const detectors = next?.trace?.detectors ?? [];
    const nominalDetector = detectors.find(candidate => ['detector', 'receiver'].includes(candidate.id)) ?? detectors[0];
    options(part, optics, stationChanged || partChanged ? next?.partId : previousPart, 'No enabled optic');
    options(detector, detectors, stationChanged ? nominalDetector?.id : previousDetector || nominalDetector?.id, 'No detector');
    if (stationChanged || traceChanged || previousPart !== part.value || previousDetector !== detector.value) {
      const existed = Boolean(job || result);
      cancel(); clearResults();
      status.textContent = next?.mode === 'dark' ? 'Acquire a sample or reference to map the optical layout.'
        : existed && next ? 'Layout, settings, or optic selection changed. Run a new map.' : readyMessage;
    } else updateControls();
  }

  function select(index) {
    if (!result || !Number.isInteger(index) || index < 0 || index >= result.rows.length) return;
    selected = index;
    tableRows.forEach((row, offset) => {
      const active = offset === index; row.classList.toggle('is-selected', active);
      row.querySelector('button').setAttribute('aria-pressed', String(active));
    });
    const point = result.rows[index];
    selection.textContent = result.axes.map((axis, offset) => axis.label + ' ' + formatNumber(offset ? point.yOffset : point.xOffset, 5) + ' ' + axis.unit).join(' · ') +
      ' · ' + formatNumber(point.power, 5) + ' mW · ' + formatNumber(point.transfer, 5) + ' % · RMS ' + formatNumber(point.rms, 5) + ' mm';
    for (const pins of plotCursors.values()) { pins.a = null; pins.b = null; }
    plot?.showPoint(0, point.xOffset, point.yOffset);
    updateControls();
  }

  function renderPlot() {
    if (!result) return;
    const data = alignmentMapSurface(result, metric.value);
    plot?.disconnect(); plot = undefined;
    surface?.disconnect(); surface = undefined;
    plotHost.hidden = display.value !== 'heatmap';
    surfaceHost.hidden = display.value !== 'surface';
    tableHost.hidden = display.value !== 'table';
    if (display.value === 'heatmap') {
      plotCursors = new Map();
      plot = renderCharts(plotHost, [{ title: data.title, xLabel: data.xLabel, yLabel: data.yLabel,
        heatmap: { x: data.x, y: data.y, z: data.z, zLabel: data.zLabel },
        note: 'Sampled geometric ray tracing. Offsets are relative to the original pose.' }], undefined, { exportFile, notify, cursors: plotCursors });
    } else if (display.value === 'surface') surface = renderSurfacePlot(surfaceHost, data);
    if (selected >= 0) select(selected);
  }

  function renderResult() {
    results.hidden = false;
    xHeading.textContent = axisLabel(result.axes[0]); yHeading.textContent = axisLabel(result.axes[1]);
    tableRows = result.rows.map((reading, index) => {
      const row = element('tr'), first = element('td'), choose = element('button', 'button', formatNumber(reading.xOffset, 5));
      choose.type = 'button'; choose.setAttribute('aria-label', 'Select ' + reading.xOffset + ' ' + result.axes[0].unit + ', ' + reading.yOffset + ' ' + result.axes[1].unit);
      first.append(choose); row.append(first);
      for (const value of [reading.yOffset, reading.transfer, reading.power, reading.count, reading.rms]) row.append(element('td', '', formatNumber(value, 5)));
      row.addEventListener('click', () => select(index)); return row;
    });
    rowsHost.replaceChildren(...tableRows);
    renderPlot();
    const best = bestAlignmentMapPoint(result.rows, 'power');
    select(best >= 0 ? best : 0);
    const point = result.rows[best];
    status.textContent = result.partName + ' · ' + result.axes[0].steps + ' × ' + result.axes[1].steps + ' sampled positions' +
      (point ? ' · Highest sampled detector power ' + formatNumber(point.power, 5) + ' mW' : ' · No finite detector readings');
  }

  async function run() {
    if (job || runButton.disabled || !context) return;
    let capture, axes, optic;
    try {
      capture = snapshot();
      if (!capture || capture.trace !== context.trace) throw new Error('The layout is changing. Run the map after it finishes updating.');
      optic = capture.trace.scene.parts.find(candidate => candidate.id === part.value);
      axes = alignmentMapGrid(optic, axisFields.map(row => ({ key: row.axis.value,
        min: row.min.valueAsNumber, max: row.max.valueAsNumber, steps: row.steps.valueAsNumber })));
    } catch (error) { status.textContent = error.message || 'The current layout is unavailable for a map.'; return; }
    const record = { capture, axes, partId: part.value, partName: optic.name, mode: capture.mode,
      station: capture.station, detectorId: detector.value, detectorName: detector.selectedOptions[0]?.textContent ?? '',
      origin: { position: [...optic.position], rotation: [...optic.rotation] }, rows: [] };
    const token = Symbol('alignment map'); job = token; updateControls();
    const total = axes[0].values.length * axes[1].values.length;
    status.textContent = 'Tracing 0 / ' + total + ' positions';
    try {
      for (const yOffset of axes[1].values) for (const xOffset of axes[0].values) {
        await tick(); if (job !== token) return;
        const point = { xOffset, yOffset, xNormalized: xOffset / (axes[0].max - axes[0].min), yNormalized: yOffset / (axes[1].max - axes[1].min) };
        const traced = await trace(capture, posePair(record, point)); if (job !== token) return;
        record.rows.push({ ...point, ...alignmentMapReadings(traced, record.detectorId) });
        status.textContent = 'Tracing ' + record.rows.length + ' / ' + total + ' positions';
      }
      result = record; selected = -1; renderResult();
    } catch (error) {
      if (job === token) { status.textContent = error.message || 'The alignment map could not be completed.'; notify?.(status.textContent); }
    } finally { if (job === token) { job = undefined; updateControls(); } }
  }

  for (const input of [part, detector, ...axisFields.flatMap(row => [row.axis, row.min, row.max, row.steps])]) input.addEventListener('change', () => {
    for (const row of axisFields) {
      const spec = alignmentMapAxes[row.axis.value];
      if (row.unit !== spec.unit) { row.min.value = spec.unit === 'mm' ? -20 : -5; row.max.value = spec.unit === 'mm' ? 20 : 5; row.unit = spec.unit; }
      row.min.parentNode.firstChild.textContent = 'From (' + spec.unit + ')';
      row.max.parentNode.firstChild.textContent = 'To (' + spec.unit + ')';
    }
    cancel(); clearResults(); status.textContent = readyMessage;
  });
  runButton.addEventListener('click', run);
  cancelButton.addEventListener('click', () => cancel());
  metric.addEventListener('change', renderPlot);
  display.addEventListener('change', renderPlot);
  powerButton.addEventListener('click', () => select(bestAlignmentMapPoint(result?.rows ?? [], 'power')));
  rmsButton.addEventListener('click', () => select(bestAlignmentMapPoint(result?.rows ?? [], 'rms')));
  plotHost.addEventListener('click', event => {
    if (!result || job) return;
    const svg = event.target.closest('svg'); if (!svg || !plotHost.contains(svg) || svg.classList.contains('is-zooming')) return;
    const area = svg.querySelector('.plot-area'); const bounds = svg.getBoundingClientRect();
    const box = svg.viewBox.baseVal; if (!area || !bounds.width || !bounds.height) return;
    const px = (event.clientX - bounds.left) * box.width / bounds.width, py = (event.clientY - bounds.top) * box.height / bounds.height;
    const left = Number(area.getAttribute('x')), top = Number(area.getAttribute('y'));
    const width = Number(area.getAttribute('width')), height = Number(area.getAttribute('height'));
    if (px < left || px > left + width || py < top || py > top + height) return;
    const x = Number(svg.dataset.xMin) + (px - left) / width * (Number(svg.dataset.xMax) - Number(svg.dataset.xMin));
    const y = Number(svg.dataset.yMin) + (1 - (py - top) / height) * (Number(svg.dataset.yMax) - Number(svg.dataset.yMin));
    const nearest = (values, value) => values.reduce((best, candidate, index) => Math.abs(candidate - value) < Math.abs(values[best] - value) ? index : best, 0);
    const column = nearest(result.axes[0].values, x), row = nearest(result.axes[1].values, y);
    select(row * result.axes[0].values.length + column);
  });
  applyButton.addEventListener('click', () => {
    if (!result || job || selected < 0 || applyButton.disabled) return;
    const record = result, point = record.rows[selected];
    try {
      const applied = apply(record.capture, posePair(record, point));
      clearResults();
      status.textContent = applied === false ? 'The layout has changed. Run a new map.' : 'Applied both offsets in one optical-layout edit.';
    } catch (error) { status.textContent = error.message || 'The offsets could not be applied.'; }
  });
  exportButton.addEventListener('click', () => {
    if (!result || job) return;
    exportFile('spectral-bench-' + result.station + '-alignment-map.csv', alignmentMapCsv(result));
  });
  updateControls();
  return { update, cancel, disconnect() { cancel(); plot?.disconnect(); surface?.disconnect(); host.replaceChildren(); } };
}
