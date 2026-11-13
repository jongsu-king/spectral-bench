import { formatNumber, renderCharts } from './charts.js';

const axes = {
  x: { axis: 'position', coordinate: 0, label: 'X', unit: 'mm', limit: 2500, range: 1500 },
  y: { axis: 'position', coordinate: 1, label: 'Y', unit: 'mm', limit: 2500, range: 1500 },
  z: { axis: 'position', coordinate: 2, label: 'Z', unit: 'mm', limit: 2500, range: 1500 },
  rx: { axis: 'rotation', coordinate: 0, label: 'Rx', unit: '°', limit: 360, range: 360 },
  ry: { axis: 'rotation', coordinate: 1, label: 'Ry', unit: '°', limit: 360, range: 360 },
  rz: { axis: 'rotation', coordinate: 2, label: 'Rz', unit: '°', limit: 360, range: 360 },
};
const metrics = {
  transfer: ['Optical transfer', '%'],
  power: ['Detector power', 'mW'],
  count: ['Detected rays', ''],
  rms: ['RMS spot radius', 'mm'],
};
const readyMessage = 'Offsets are relative to the current pose.';

function detectorReadings(trace, detectorId) {
  const detector = trace.detectors.find(candidate => candidate.id === detectorId);
  let rms = NaN;
  if (detector?.centroid && detector.power > 0) {
    const [u, v] = detector.centroid;
    const moment = detector.hits.reduce((sum, hit) => sum + hit.power * ((hit.u - u) ** 2 + (hit.v - v) ** 2), 0);
    rms = Math.sqrt(moment / detector.power);
  }
  return { transfer: 100 * trace.coupling, power: detector?.power ?? NaN, count: detector?.count ?? NaN, rms };
}

function csvCell(value) {
  if (value == null || (typeof value === 'number' && !Number.isFinite(value))) return '';
  return '"' + String(value).replaceAll('"', '""') + '"';
}

export function createAlignmentSweep({ snapshot, trace, apply, exportFile }) {
  const el = name => document.getElementById('alignment-sweep-' + name);
  const part = el('part');
  const detector = el('detector');
  const axis = el('axis');
  const start = el('min');
  const end = el('max');
  const steps = el('steps');
  const runButton = el('run');
  const cancelButton = el('cancel');
  const applyButton = el('apply');
  const metric = el('metric');
  const status = el('status');
  const output = el('results');
  const rows = el('rows');
  const plotHost = el('plot');
  let context;
  let job;
  let result;
  let plot;
  let rowButtons = [];
  let selectedRow = -1;
  let previousUnit = axes[axis.value].unit;

  function updateControls() {
    const busy = Boolean(job);
    runButton.disabled = busy || !part.value || context?.mode === 'dark';
    part.disabled = busy || !part.value;
    detector.disabled = busy || !detector.value;
    for (const field of [axis, start, end, steps]) field.disabled = busy;
    cancelButton.disabled = !busy;
    applyButton.disabled = !result?.rows[selectedRow]?.offset;
  }

  function clearResults() {
    plot?.disconnect();
    plot = undefined;
    result = undefined;
    selectedRow = -1;
    rowButtons = [];
    plotHost.replaceChildren();
    rows.replaceChildren();
    output.hidden = true;
    updateControls();
  }

  function cancel(message = 'Sweep cancelled.') {
    if (!job) return;
    job = undefined;
    updateControls();
    status.textContent = message;
  }

  function updateOptions(select, entries, preferred, emptyLabel) {
    const key = JSON.stringify(entries.map(entry => [entry.id, entry.name]));
    if (select.dataset.options !== key) {
      select.replaceChildren(...entries.map(entry => new Option(entry.name, entry.id)));
      if (!entries.length) select.add(new Option(emptyLabel, ''));
      select.dataset.options = key;
    }
    select.value = entries.some(entry => entry.id === preferred) ? preferred : entries[0]?.id ?? '';
  }

  function update(next) {
    const newStation = context?.station !== next?.station;
    const newTrace = context?.trace !== next?.trace || context?.mode !== next?.mode;
    const newPart = context?.partId !== next?.partId;
    if (!newStation && !newTrace && !newPart) return;
    const oldPart = part.value;
    const oldDetector = detector.value;
    context = next;
    const optics = next?.trace?.scene.parts.filter(entry => entry.enabled !== false) ?? [];
    const detectors = next?.trace?.detectors ?? [];
    const defaultDetector = detectors.find(entry => ['detector', 'receiver'].includes(entry.id)) ?? detectors[0];
    const preferredPart = newStation || newPart ? next?.partId : oldPart;
    updateOptions(part, optics, preferredPart, 'No enabled optics');
    updateOptions(detector, detectors, newStation ? defaultDetector?.id : oldDetector || defaultDetector?.id, 'No detector');
    if (newStation || newTrace || part.value !== oldPart || detector.value !== oldDetector) {
      const invalidated = Boolean(result || job);
      cancel();
      clearResults();
      status.textContent = next?.mode === 'dark' ? 'Acquire a sample or reference to sweep the optical layout.'
        : invalidated && next ? 'Layout or optic selection changed. Run a new sweep.' : readyMessage;
    } else updateControls();
  }

  function selectRow(index) {
    selectedRow = index;
    rowButtons.forEach((button, position) => {
      const active = position === selectedRow;
      button.setAttribute('aria-pressed', String(active));
      button.closest('tr').classList.toggle('is-selected', active);
    });
    if (result) plot?.showPoint(0, result.rows[index].offset);
    updateControls();
  }

  function renderPlot() {
    if (!result) return;
    const field = metric.value;
    const [label, unit] = metrics[field];
    const x = result.rows.map(row => row.offset);
    const y = result.rows.map(row => row[field]);
    plot?.disconnect();
    plot = renderCharts(plotHost, [{ title: label, xLabel: result.spec.label + ' offset (' + result.spec.unit + ')',
      yLabel: unit ? label + ' (' + unit + ')' : label, series: [{ name: label, x, y }] }], undefined, { cursors: new Map() });
    if (selectedRow >= 0) plot.showPoint(0, x[selectedRow]);
  }

  function renderResult() {
    output.hidden = false;
    el('offset-heading').textContent = 'Offset (' + result.spec.unit + ')';
    rowButtons = [];
    rows.replaceChildren(...result.rows.map((reading, index) => {
      const row = document.createElement('tr');
      const offset = document.createElement('td');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'button';
      button.textContent = formatNumber(reading.offset, 5);
      button.setAttribute('aria-label', 'Select offset ' + button.textContent + ' ' + result.spec.unit);
      rowButtons.push(button);
      offset.append(button);
      row.append(offset);
      for (const value of [reading.transfer, reading.power, reading.count, reading.rms]) {
        const cell = document.createElement('td');
        cell.textContent = formatNumber(value, 5);
        row.append(cell);
      }
      row.addEventListener('click', () => selectRow(index));
      return row;
    }));
    const best = result.rows.reduce((index, row, candidate) => {
      const current = result.rows[index];
      if (row.transfer > current.transfer || (row.transfer === current.transfer && Math.abs(row.offset) < Math.abs(current.offset))) return candidate;
      return index;
    }, 0);
    renderPlot();
    selectRow(best);
    const winner = result.rows[best];
    status.textContent = result.partName + ' · ' + result.rows.length + ' points · Highest transfer ' +
      formatNumber(winner.transfer, 5) + ' % at ' + formatNumber(winner.offset, 5) + ' ' + result.spec.unit;
  }

  async function run() {
    if (job || runButton.disabled || !context) return;
    let capture;
    try {
      capture = snapshot();
    } catch (error) {
      status.textContent = error.message || 'The current layout is unavailable for a sweep.';
      return;
    }
    if (!capture) {
      status.textContent = 'The current layout is unavailable for a sweep.';
      return;
    }
    const spec = axes[axis.value];
    const min = start.valueAsNumber;
    const max = end.valueAsNumber;
    const count = steps.valueAsNumber;
    const optic = (context.trace.parts ?? context.trace.scene.parts).find(entry => entry.id === part.value);
    const origin = optic?.[spec.axis]?.[spec.coordinate];
    clearResults();
    if (![min, max, origin].every(Number.isFinite) || min >= max || Math.abs(min) > spec.range || Math.abs(max) > spec.range ||
        Math.abs(origin + min) > spec.limit || Math.abs(origin + max) > spec.limit || !Number.isInteger(count) || count < 2 || count > 61) {
      status.textContent = 'Enter 2–61 points and increasing offsets within ±' + spec.range + ' ' + spec.unit +
        '. The final pose must stay within ±' + spec.limit + ' ' + spec.unit + '.';
      return;
    }
    const pose = { partId: part.value, axis: spec.axis, coordinate: spec.coordinate };
    const selectedDetector = detector.value;
    const readings = [];
    const currentJob = Symbol('alignment sweep');
    job = currentJob;
    updateControls();
    status.textContent = 'Tracing 0 / ' + count + ' positions';
    try {
      for (let index = 0; index < count; index++) {
        await new Promise(resolve => requestAnimationFrame(resolve));
        if (job !== currentJob) return;
        const offset = min + (max - min) * index / (count - 1);
        const reading = await trace(capture, { ...pose, offset });
        if (job !== currentJob) return;
        readings.push({ offset, ...detectorReadings(reading, selectedDetector) });
        status.textContent = 'Tracing ' + readings.length + ' / ' + count + ' positions';
      }
      result = { capture, pose, spec, station: context.station, partName: optic.name, detectorId: selectedDetector,
        detectorName: detector.selectedOptions[0]?.textContent ?? '', rows: readings };
      renderResult();
    } catch (error) {
      if (job === currentJob) status.textContent = error.message || 'The sweep could not be completed.';
    } finally {
      if (job === currentJob) {
        job = undefined;
        updateControls();
      }
    }
  }

  for (const field of [part, detector, start, end, steps, axis]) field.addEventListener('change', () => {
    const unit = axes[axis.value].unit;
    if (previousUnit !== unit) {
      start.value = unit === 'mm' ? -20 : -5;
      end.value = unit === 'mm' ? 20 : 5;
      el('min-label').textContent = 'From (' + unit + ')';
      el('max-label').textContent = 'To (' + unit + ')';
      previousUnit = unit;
    }
    clearResults();
    status.textContent = readyMessage;
  });
  runButton.addEventListener('click', run);
  cancelButton.addEventListener('click', () => cancel());
  metric.addEventListener('change', renderPlot);
  applyButton.addEventListener('click', () => {
    const offset = result?.rows[selectedRow]?.offset;
    if (!offset) return;
    const applied = apply(result.capture, { ...result.pose, offset });
    clearResults();
    status.textContent = applied === false ? 'The layout has changed. Run a new sweep.' : 'Applied offset ' + formatNumber(offset, 5) + '.';
  });
  el('export').addEventListener('click', () => {
    if (!result) return;
    const records = [['instrument', 'optic_id', 'optic', 'detector_id', 'detector', 'axis', 'offset', 'offset_unit',
      'optical_transfer_percent', 'detector_power_mw', 'detected_rays', 'rms_spot_mm']];
    for (const row of result.rows) records.push([result.station, result.pose.partId, result.partName, result.detectorId,
      result.detectorName, result.spec.label, row.offset, result.spec.unit, row.transfer, row.power, row.count, row.rms]);
    exportFile('spectral-bench-' + result.station + '-alignment-sweep.csv', '\uFEFF' +
      records.map(record => record.map(csvCell).join(',')).join('\r\n'));
  });
  updateControls();
  return { update, cancel };
}
