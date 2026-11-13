import { formatNumber } from './charts.js';
import {
  compareMeasurement, MAX_MEASUREMENT_FILE_BYTES, measurementPairs, parseMeasurementFile, validateMeasurementTrace,
} from './measurement-csv.js';

const el = id => document.getElementById(id);
const shortText = value => typeof value === 'string' ? value.slice(0, 240) : '';

function hasDistinctSamples(series) {
  let first;
  for (let i = 0; i < series.x.length; i++) {
    const x = series.x[i];
    if (!Number.isFinite(x) || !Number.isFinite(series.y[i])) continue;
    if (first !== undefined && x !== first) return true;
    first = x;
  }
  return false;
}

function targetTraces(charts) {
  return charts.flatMap((chart, index) => chart.heatmap ? [] : (chart.series ?? []).flatMap(series =>
    hasDistinctSamples(series) ? [{
      index, title: chart.title, xLabel: chart.xLabel, yLabel: chart.yLabel, seriesName: series.name,
    }] : []));
}

function sameAxes(chart, target) {
  return chart && !chart.heatmap && chart.xLabel === target.xLabel && chart.yLabel === target.yLabel;
}

function comparisonTarget(charts, target) {
  const titleIndex = charts.findIndex(chart => sameAxes(chart, target) && chart.title === target.title);
  if (titleIndex >= 0) return titleIndex;
  // TA titles contain the current delay, while their axes and ΔA series stay the same.
  const previousSlot = charts[target.index];
  return sameAxes(previousSlot, target) && previousSlot.series?.some(series => series.name === target.seriesName) ? target.index : -1;
}

function unit(label) {
  const suffix = /(?:\(([^()]*)\)|\[([^\[\]]*)\])\s*$/.exec(label ?? '')?.slice(1).find(Boolean);
  const normalized = suffix?.normalize('NFKC').replaceAll('μ', 'u').replace(/[−⁻]/g, '-').replace(/[.\s^{}]/g, '').toLowerCase();
  return /^deg(?:rees?)?$/.test(normalized ?? '') ? '°' : normalized ?? '';
}

function axisName(label) {
  return label.replace(/\s*(?:\([^()]*\)|\[[^\[\]]*\])\s*$/, '').trim().toLowerCase();
}

function axisMismatch(pairs, target) {
  return [[pairs.xLabel, target.xLabel], [pairs.yLabel, target.yLabel]].some(([from, to]) => {
    const source = unit(from);
    const destination = unit(to);
    return source && destination && source !== destination;
  });
}

export function restoreMeasuredTrace(value) {
  if (!value || typeof value !== 'object') return null;
  const trace = validateMeasurementTrace(value);
  const target = value.target;
  if (!trace || !target || !Number.isInteger(target.index) || target.index < 0 || target.index > 20) return null;
  const sanitizedTarget = { index: target.index };
  for (const key of ['title', 'xLabel', 'yLabel', 'seriesName']) sanitizedTarget[key] = shortText(target[key]);
  if (!sanitizedTarget.title || !sanitizedTarget.seriesName) return null;
  return { ...trace, filename: shortText(value.filename) || 'Measurement', target: sanitizedTarget };
}

export function measuredComparison(charts, measurement) {
  if (!measurement) return null;
  const chartIndex = comparisonTarget(charts, measurement.target);
  if (chartIndex < 0) return null;
  const chart = charts[chartIndex];
  const series = chart.series?.find(candidate => candidate.name === measurement.target.seriesName);
  return { chartIndex, chart, series, statistics: series ? compareMeasurement(measurement, series) : null };
}

export function addMeasuredOverlay(charts, measurement, chartIndex) {
  const chart = charts[chartIndex];
  if (!chart) return charts;
  const result = [...charts];
  result[chartIndex] = {
    ...chart,
    series: [...(chart.series ?? []), {
      x: measurement.x, y: measurement.y, name: 'Measured · ' + measurement.filename,
      color: '#9a3b20', dash: '5 3', measured: true,
    }],
  };
  return result;
}

export function createMeasurementImport({ context, openNative, apply, toggle, clear, notify }) {
  const dialog = el('measurement-import-dialog');
  const input = el('measurement-file');
  const xColumn = el('measurement-x-column');
  const yColumn = el('measurement-y-column');
  const targetSelect = el('measurement-target');
  const traceSelect = el('measurement-trace-select');
  const applyButton = el('measurement-apply');
  let pending;
  let browserRequest;

  function selectedTarget() {
    return pending?.targets[targetSelect.selectedIndex];
  }

  function selectedPairs() {
    if (pending.parsed.traces.length) return pending.parsed.traces[traceSelect.selectedIndex];
    return measurementPairs(pending.parsed, xColumn.selectedIndex, yColumn.selectedIndex);
  }

  function preview() {
    const target = selectedTarget();
    const output = el('measurement-import-preview');
    el('measurement-target-axes').textContent = target ? 'Plot axes: ' + target.xLabel + ' / ' + target.yLabel : '';
    try {
      if (!target) throw new Error('Select a simulation trace.');
      const pairs = selectedPairs();
      if (axisMismatch(pairs, target)) throw new Error('The CSV units differ from the plot units. Select compatible columns and a plot.');
      output.textContent = pairs.x.length.toLocaleString() + ' samples' +
        (pairs.skipped ? ' · ' + pairs.skipped.toLocaleString() + ' rows without numeric pairs skipped' : '') +
        ' · X and Y are used in the units of the selected plot.';
      output.dataset.error = 'false';
      applyButton.disabled = false;
    } catch (error) {
      output.textContent = error.message;
      output.dataset.error = 'true';
      applyButton.disabled = true;
    }
  }

  function preferMatchingTarget() {
    const trace = pending.parsed.traces[traceSelect.selectedIndex];
    if (!trace) return;
    const match = pending.targets.findIndex(item =>
      item.title === trace.chartTitle && item.xLabel === trace.xLabel && item.yLabel === trace.yLabel &&
      item.seriesName === trace.name);
    if (match >= 0) targetSelect.selectedIndex = match;
  }

  function load(filename, content, request) {
    const current = context();
    if (!current || request?.station !== current.station || request.state !== current.state) {
      notify('Select the instrument again and reopen the measurement file.');
      return;
    }
    const parsed = parseMeasurementFile(content);
    const targets = targetTraces(current.charts);
    if (!targets.length) throw new Error('No line trace is available in this measurement.');
    pending = { filename: shortText(filename), parsed, targets, request };
    const longForm = parsed.traces.length > 0;
    el('measurement-file-name').textContent = pending.filename;
    el('measurement-columns').hidden = longForm;
    el('measurement-trace-label').hidden = !longForm;
    traceSelect.hidden = !longForm;
    traceSelect.replaceChildren(...parsed.traces.map((trace, index) =>
      new Option([trace.chartTitle, trace.name, trace.acquisition].filter(Boolean).join(' · '), index)));
    for (const field of [xColumn, yColumn]) {
      field.replaceChildren(...parsed.columns.map((name, index) => new Option(name, index)));
    }
    targetSelect.replaceChildren(...targets.map((target, index) =>
      new Option(target.title + ' · ' + target.seriesName, index)));
    const preferred = targets.findIndex(target => target.index === current.plotIndex);
    targetSelect.selectedIndex = preferred >= 0 ? preferred : 0;
    preferMatchingTarget();
    if (!longForm) {
      const target = selectedTarget();
      const matchingX = parsed.columns.findIndex(name => axisName(name) === axisName(target.xLabel));
      const likelyX = parsed.columns.findIndex(name => /^(?:x\b|wave\s*(?:length|number)\b|raman shift\b|delay\b|frequency\b)/i.test(name));
      xColumn.selectedIndex = matchingX >= 0 ? matchingX : Math.max(0, likelyX);
      const matchingY = parsed.columns.findIndex((name, index) =>
        index !== xColumn.selectedIndex && axisName(name) === axisName(target.yLabel));
      yColumn.selectedIndex = matchingY >= 0 ? matchingY : xColumn.selectedIndex === 0 ? 1 : 0;
    }
    preview();
    if (!dialog.open) dialog.showModal();
  }

  el('measurement-import').addEventListener('click', () => {
    const request = context();
    if (!request) return;
    if (openNative(reply => load(reply.name, reply.content, request))) return;
    browserRequest = request;
    input.click();
  });

  input.addEventListener('change', async () => {
    const request = browserRequest ?? context();
    browserRequest = null;
    const file = input.files[0];
    input.value = '';
    if (!file || !request) return;
    try {
      if (file.size > MAX_MEASUREMENT_FILE_BYTES) throw new Error('The measurement file exceeds 4 MB.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf-16le'
        : bytes[0] === 0xfe && bytes[1] === 0xff ? 'utf-16be' : 'utf-8';
      let content;
      try { content = new TextDecoder(encoding, { fatal: true }).decode(bytes); }
      catch { throw new Error('Save the measurement file as UTF-8 or UTF-16 with a BOM and try again.'); }
      load(file.name, content, request);
    } catch (error) { notify(error.message); }
  });

  for (const field of [xColumn, yColumn, targetSelect]) field.addEventListener('change', preview);
  traceSelect.addEventListener('change', () => { preferMatchingTarget(); preview(); });
  applyButton.addEventListener('click', () => {
    if (!pending || applyButton.disabled) return;
    try {
      const current = context();
      if (current?.station !== pending.request.station || current.state !== pending.request.state) {
        throw new Error('The instrument changed. Reopen the measurement file.');
      }
      const target = selectedTarget();
      const pairs = selectedPairs();
      if (axisMismatch(pairs, target)) throw new Error('Select compatible CSV and plot units.');
      const index = comparisonTarget(current.charts, target);
      if (index < 0) throw new Error('The selected plot is no longer available.');
      apply({ x: pairs.x, y: pairs.y, xLabel: pairs.xLabel, yLabel: pairs.yLabel, filename: pending.filename, target }, index);
      dialog.close();
    } catch (error) {
      el('measurement-import-preview').textContent = error.message;
      el('measurement-import-preview').dataset.error = 'true';
    }
  });
  dialog.addEventListener('close', () => { pending = null; });
  el('measurement-overlay').addEventListener('change', event => toggle(event.target.checked));
  el('measurement-clear').addEventListener('click', clear);

  return {
    update(measurement, show, comparison) {
      el('measured-trace').hidden = !measurement;
      el('measurement-overlay').disabled = !measurement;
      el('measurement-overlay').checked = show;
      el('measurement-clear').disabled = !measurement;
      const status = el('measurement-import-status');
      const description = measurement ? measurement.filename + ' · ' + measurement.x.length.toLocaleString() +
        ' samples · ' + measurement.target.title : 'No measured trace';
      if (status.textContent !== description) status.textContent = description;
      const output = el('measurement-comparison');
      const statistics = comparison?.statistics;
      if (!measurement) output.textContent = '';
      else if (!comparison) output.textContent = 'Matching plot unavailable';
      else if (!statistics) output.textContent = 'Matching simulation trace unavailable';
      else if (!statistics.count) output.textContent = 'No overlapping samples';
      else {
        output.textContent = 'n=' + statistics.count.toLocaleString() + ' · RMSE ' + formatNumber(statistics.rmse, 4) +
          ' · Bias (meas − sim) ' + formatNumber(statistics.bias, 4);
      }
    },
  };
}
