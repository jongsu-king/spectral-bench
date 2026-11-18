import { formatNumber } from './charts.js';

const finite = Number.isFinite;
const baselineTypes = new Set(['none', 'constant', 'linear']);
const sequence = value => Array.isArray(value) || ArrayBuffer.isView(value);

function normalisedTrace(series) {
  if (!sequence(series?.x) || !sequence(series?.y) || series.x.length !== series.y.length) {
    throw new Error('Range analysis needs matching X and Y arrays.');
  }
  const points = [];
  let previous, direction = 0;
  for (let index = 0; index < series.x.length; index++) {
    const x = series.x[index], y = series.y[index];
    if (finite(x)) {
      if (previous !== undefined) {
        const step = Math.sign(x - previous);
        if (!step) throw new Error('Range analysis needs distinct X coordinates. Combine duplicate observations before integration.');
        if (direction && step !== direction) throw new Error('Range analysis needs a monotonic X axis. Sort the trace or separate overlapping runs before integration.');
        direction = step;
      }
      previous = x;
    }
    points.push(finite(x) && finite(y) ? { x, y } : null);
  }
  if (direction < 0) points.reverse();
  const runs = [];
  let current;
  for (const point of points) {
    if (!point) { current = null; continue; }
    if (!current) runs.push(current = []);
    current.push(point);
  }
  const valid = runs.flat();
  if (valid.length < 2) throw new Error('Range analysis needs at least two finite observations.');
  if (!finite(valid.at(-1).x - valid[0].x)) throw new Error('The numeric X span is too large for range analysis. Rescale the axis.');
  return { runs, valid };
}

function interpolatedPoint(run, target) {
  for (let index = 0; index < run.length; index++) {
    const point = run[index];
    if (point.x === target) return { ...point, interpolated: false };
    const next = run[index + 1];
    if (next && point.x < target && next.x > target) {
      const fraction = (target - point.x) / (next.x - point.x);
      // Convex weights avoid overflowing the difference of large opposite values.
      return { x: target, y: point.y * (1 - fraction) + next.y * fraction, interpolated: true };
    }
  }
  return null;
}

function endpoint(runs, target) {
  for (const run of runs) {
    if (target >= run[0].x && target <= run.at(-1).x) return interpolatedPoint(run, target);
  }
  return null;
}

function compensatedSum() {
  let sum = 0, correction = 0;
  return {
    add(value) {
      const adjusted = value - correction;
      const next = sum + adjusted;
      correction = (next - sum) - adjusted;
      sum = next;
    },
    value: () => sum,
  };
}

function observedStatistics(points) {
  let mean = 0, m2 = 0, count = 0, minimum, maximum, scale = 0, scaledSquares = 0;
  for (const point of points) {
    count++;
    const difference = point.y - mean;
    mean += difference / count;
    m2 += difference * (point.y - mean);
    if (!minimum || point.y < minimum.y) minimum = { ...point };
    if (!maximum || point.y > maximum.y) maximum = { ...point };
    const absolute = Math.abs(point.y);
    if (absolute > scale) {
      scaledSquares = 1 + scaledSquares * (scale / absolute) ** 2;
      scale = absolute;
    } else if (absolute) scaledSquares += (absolute / scale) ** 2;
  }
  return {
    count,
    mean: count ? mean : null,
    sampleSD: count > 1 ? Math.sqrt(Math.max(0, m2 / (count - 1))) : null,
    rms: count ? scale * Math.sqrt(scaledSquares / count) : null,
    minimum: minimum ?? null,
    maximum: maximum ?? null,
  };
}

/**
 * Analyse observations without smoothing or extrapolation.
 *
 * X must be strictly monotonic; a descending axis is reversed. Duplicate X or
 * an axis that changes direction is rejected instead of silently combining data.
 * Any nonfinite X or Y breaks the trace. Range edges are linearly interpolated
 * inside each valid run, but missing intervals are never bridged. Descriptive
 * statistics use only actual finite observations in the closed selected range.
 * Areas integrate the piecewise-linear, baseline-corrected signal. Negative area
 * retains its sign; the centroid uses only its positive area. No covered interval
 * gives null areas rather than implying a measured zero.
 */
export function analyzeTrace(series, options = {}) {
  const { runs, valid } = normalisedTrace(series);
  const baselineType = options.baseline ?? 'none';
  if (!baselineTypes.has(baselineType)) throw new Error('Choose no baseline, a constant baseline, or a line through the range endpoints.');
  const requestedMin = options.min ?? valid[0].x;
  const requestedMax = options.max ?? valid.at(-1).x;
  if (!finite(requestedMin) || !finite(requestedMax) || requestedMin >= requestedMax) {
    throw new Error('Enter a range with the lower X value below the upper X value.');
  }
  const low = Math.max(requestedMin, valid[0].x);
  const high = Math.min(requestedMax, valid.at(-1).x);
  const width = high - low;
  if (!(width > 0) || !finite(width)) throw new Error('The selected range does not overlap a finite trace span.');
  let baselineStart = 0, baselineEnd = 0;
  if (baselineType === 'constant') {
    if (!finite(options.baselineValue)) throw new Error('Enter a finite constant baseline in the signal units.');
    baselineStart = baselineEnd = options.baselineValue;
  } else if (baselineType === 'linear') {
    const start = endpoint(runs, low), end = endpoint(runs, high);
    if (!start || !end) throw new Error('A linear baseline needs finite values at both range boundaries. Move the limits away from missing data.');
    baselineStart = start.y;
    baselineEnd = end.y;
  }
  const baselineAt = x => {
    const fraction = (x - low) / width;
    return baselineStart * (1 - fraction) + baselineEnd * fraction;
  };
  const observed = valid.filter(point => point.x >= low && point.x <= high);
  const statistics = observedStatistics(observed);
  const positive = compensatedSum(), negative = compensatedSum(), covered = compensatedSum();
  const curve = { x: [], y: [], interpolated: [] };
  let segments = 0, positiveCentroidOffset = null;

  function positiveTrapezoid(x, dx, a, b) {
    const area = dx * (a * 0.5 + b * 0.5);
    if (!(area > 0)) return;
    const previousArea = positive.value();
    positive.add(area);
    const scale = Math.max(a, b);
    const aScaled = a / scale, bScaled = b / scale;
    const position = x - low + dx * (aScaled + 2 * bScaled) / (3 * (aScaled + bScaled));
    positiveCentroidOffset = previousArea === 0 ? position
      : positiveCentroidOffset + (position - positiveCentroidOffset) * (area / positive.value());
  }

  for (const run of runs) {
    const start = Math.max(low, run[0].x), stop = Math.min(high, run.at(-1).x);
    if (start > stop) continue;
    const points = [interpolatedPoint(run, start),
      ...run.filter(point => point.x > start && point.x < stop).map(point => ({ ...point, interpolated: false })),
      ...(stop > start ? [interpolatedPoint(run, stop)] : [])];
    if (curve.x.length) { curve.x.push(null); curve.y.push(null); curve.interpolated.push(false); }
    const corrected = points.map(point => ({ ...point, y: point.y - baselineAt(point.x) }));
    for (const point of corrected) {
      curve.x.push(point.x); curve.y.push(point.y); curve.interpolated.push(point.interpolated);
    }
    if (corrected.length > 1) segments++;
    for (let index = 0; index + 1 < corrected.length; index++) {
      const a = corrected[index], b = corrected[index + 1];
      const dx = b.x - a.x;
      covered.add(dx);
      if (a.y >= 0 && b.y >= 0) positiveTrapezoid(a.x, dx, a.y, b.y);
      else if (a.y <= 0 && b.y <= 0) negative.add(dx * (a.y * 0.5 + b.y * 0.5));
      else {
        const scale = Math.max(Math.abs(a.y), Math.abs(b.y));
        const first = Math.abs(a.y) / scale, second = Math.abs(b.y) / scale;
        const leftWidth = dx * first / (first + second);
        if (a.y > 0) {
          positiveTrapezoid(a.x, leftWidth, a.y, 0);
          negative.add((dx - leftWidth) * b.y * 0.5);
        } else {
          negative.add(leftWidth * a.y * 0.5);
          positiveTrapezoid(a.x + leftWidth, dx - leftWidth, 0, b.y);
        }
      }
    }
  }
  const coveredWidth = covered.value();
  const positiveArea = coveredWidth > 0 ? positive.value() : null;
  const negativeArea = coveredWidth > 0 ? negative.value() : null;
  const result = {
    range: [low, high], requestedRange: [requestedMin, requestedMax],
    statistics,
    baseline: { type: baselineType, value: baselineType === 'constant' ? baselineStart : null,
      start: baselineStart, end: baselineEnd },
    coveredWidth, coverage: coveredWidth / width, segments,
    integral: {
      net: coveredWidth > 0 ? positiveArea + negativeArea : null,
      positive: positiveArea, negative: negativeArea,
      absolute: coveredWidth > 0 ? positiveArea - negativeArea : null,
      positiveCentroid: positiveCentroidOffset === null ? null : low + positiveCentroidOffset,
    },
    corrected: curve,
    baselineCurve: { x: [low, high], y: [baselineStart, baselineEnd] },
    warnings: [],
  };
  if (coveredWidth === 0) result.warnings.push('No continuous interval is covered; areas are unavailable.');
  else if (result.coverage < 1 - 1e-12) result.warnings.push('Missing intervals are excluded from the area.');
  if (low !== requestedMin || high !== requestedMax) result.warnings.push('The range was clipped to the finite trace extent.');
  if (statistics.count === 0) result.warnings.push('No original observations lie inside this range; only interpolated boundary values contribute.');
  const numericResults = [statistics.mean, statistics.sampleSD, statistics.rms, ...Object.values(result.integral),
    ...curve.y, coveredWidth, baselineStart, baselineEnd];
  if (numericResults.some(value => value !== null && !finite(value))) {
    throw new Error('The numeric span is too large for range analysis. Rescale the axis or signal.');
  }
  return result;
}

const unitFrom = label => /(?:\(([^()]*)\)|\[([^\[\]]*)\])\s*$/.exec(label ?? '')?.slice(1).find(Boolean) ?? '';
const csv = value => value == null || (typeof value === 'number' && !finite(value)) ? '' : '"' + String(value).replaceAll('"', '""') + '"';
const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const field = (text, control) => { const label = node('label'); label.append(node('span', '', text), control); return label; };
const numberInput = (id, label) => {
  const input = node('input'); input.type = 'number'; input.id = id; input.step = 'any'; input.setAttribute('aria-label', label); return input;
};
const button = (id, text) => { const item = node('button', 'button', text); item.id = id; item.type = 'button'; return item; };
const short = value => formatNumber(value, 6);

function selectedDefault(series) {
  let best = 0, rank = -Infinity;
  series.forEach((trace, index) => {
    if (!trace.x?.length) return;
    const score = (/^sample$|^pump on$/i.test(trace.name ?? '') ? 10 : 0)
      - (trace.memory || trace.measured ? 20 : 0)
      - (/reference|background|(^|\b)IRF\b|reconvolution fit|delay position/i.test(trace.name ?? '') ? 5 : 0) - index * 0.01;
    if (score > rank) { best = index; rank = score; }
  });
  return best;
}

export function analysisQuantities(record) {
  const { result, xLabel, yLabel } = record;
  const xUnit = unitFrom(xLabel), yUnit = unitFrom(yLabel);
  const areaUnit = [yUnit || 'signal', xUnit || 'X'].join('·');
  return [
    ['range_min', result.range[0], xUnit], ['range_max', result.range[1], xUnit],
    ['requested_range_min', result.requestedRange[0], xUnit], ['requested_range_max', result.requestedRange[1], xUnit],
    ['baseline', result.baseline.type, ''], ['constant_baseline', result.baseline.value, yUnit],
    ['baseline_at_min', result.baseline.start, yUnit], ['baseline_at_max', result.baseline.end, yUnit],
    ['observed_count', result.statistics.count, ''], ['observed_mean', result.statistics.mean, yUnit],
    ['observed_sample_sd', result.statistics.sampleSD, yUnit], ['observed_rms', result.statistics.rms, yUnit],
    ['observed_minimum', result.statistics.minimum?.y, yUnit], ['observed_minimum_x', result.statistics.minimum?.x, xUnit],
    ['observed_maximum', result.statistics.maximum?.y, yUnit], ['observed_maximum_x', result.statistics.maximum?.x, xUnit],
    ['covered_width', result.coveredWidth, xUnit], ['coverage_fraction', result.coverage, ''],
    ['continuous_segments', result.segments, ''], ['net_area', result.integral.net, areaUnit],
    ['positive_area', result.integral.positive, areaUnit], ['negative_area', result.integral.negative, areaUnit],
    ['absolute_area', result.integral.absolute, areaUnit], ['positive_area_centroid', result.integral.positiveCentroid, xUnit],
    ['integration_method', 'Piecewise linear; no extrapolation or missing-interval bridging', ''],
    ['statistics_method', 'Original finite observations only; sample SD uses n−1', ''],
    ['warnings', result.warnings.join(' '), ''],
  ];
}

/** UI controller for a host div with id trace-analysis. It never mutates a trace. */
export function createTraceAnalysis({ repaint, exportFile }) {
  const host = document.getElementById('trace-analysis');
  if (!host) throw new Error('Trace analysis needs the #trace-analysis host.');
  host.classList.add('trace-analysis');
  const controls = node('div', 'trace-analysis-controls');
  const traceSelect = node('select'); traceSelect.id = 'stats-trace'; traceSelect.setAttribute('aria-label', 'Range-analysis trace');
  const minimum = numberInput('stats-min', 'Lower analysis limit');
  const maximum = numberInput('stats-max', 'Upper analysis limit');
  const baseline = node('select'); baseline.id = 'stats-baseline';
  baseline.append(new Option('None (zero)', 'none'), new Option('Constant', 'constant'), new Option('Line through endpoints', 'linear'));
  const baselineValue = numberInput('stats-baseline-value', 'Constant baseline'); baselineValue.value = '0';
  const constantField = field('Value', baselineValue);
  const cursors = button('stats-cursors', 'Use A/B');
  const run = button('stats-run', 'Analyze range');
  const save = button('stats-export', 'Export statistics CSV');
  controls.append(field('Trace', traceSelect), field('From', minimum), field('To', maximum),
    field('Baseline', baseline), constantField, cursors, run, save);
  const status = node('p', 'trace-analysis-status'); status.id = 'stats-status'; status.setAttribute('role', 'status');
  const summary = node('div', 'trace-analysis-summary'); summary.id = 'stats-results';
  const note = node('p', 'trace-analysis-note', 'Statistics use original observations. Areas use linear segments after baseline subtraction, interpolate range edges, and exclude missing intervals. Negative area retains its sign. Positive-area centroid is unavailable when there is no positive area.');
  host.replaceChildren(controls, status, summary, note);
  let context, optionKey;

  function panelState(value) {
    const key = JSON.stringify([value.chartIndex, value.chart?.title, value.chart?.xLabel, value.chart?.yLabel]);
    if (value.state.traceAnalysis?.key !== key) {
      value.state.traceAnalysis = { key, series: selectedDefault(value.chart?.series ?? []), min: '', max: '', baseline: 'none', baselineValue: '0', output: null, error: '' };
    }
    return value.state.traceAnalysis;
  }

  function readInputs() {
    if (!context) return;
    const settings = panelState(context);
    Object.assign(settings, { series: Number(traceSelect.value), min: minimum.value, max: maximum.value,
      baseline: baseline.value, baselineValue: baselineValue.value, output: null, error: '' });
  }

  function syncCursors() {
    const { chart, state } = context ?? {};
    const pins = chart && state.cursors?.get(JSON.stringify([chart.title, chart.xLabel, chart.yLabel]));
    cursors.disabled = !pins?.a || !pins?.b || pins.a.x === pins.b.x;
  }

  for (const input of [traceSelect, minimum, maximum, baseline, baselineValue]) input.addEventListener('change', () => { readInputs(); repaint(); });
  cursors.addEventListener('click', () => {
    const pins = context?.state.cursors?.get(JSON.stringify([context.chart.title, context.chart.xLabel, context.chart.yLabel]));
    if (!pins?.a || !pins?.b) return;
    [minimum.value, maximum.value] = [pins.a.x, pins.b.x].sort((a, b) => a - b);
    readInputs(); repaint();
  });
  run.addEventListener('click', () => {
    readInputs();
    const settings = panelState(context);
    const trace = context.chart?.series?.[settings.series];
    try {
      const result = analyzeTrace(trace, { min: settings.min === '' ? undefined : Number(settings.min),
        max: settings.max === '' ? undefined : Number(settings.max), baseline: settings.baseline,
        baselineValue: settings.baselineValue === '' ? NaN : Number(settings.baselineValue) });
      settings.output = { result, x: trace.x, y: trace.y, id: context.id, mode: context.state.mode,
        title: context.chart.title, name: trace.name ?? 'Signal', xLabel: context.chart.xLabel, yLabel: context.chart.yLabel };
    } catch (error) { settings.error = error.message; }
    repaint();
  });

  function currentAnalysis(result, state) {
    const output = state.traceAnalysis?.output;
    if (!output) return null;
    const traceExists = result?.charts?.some(chart => chart.series?.some(trace => trace.x === output.x && trace.y === output.y))
      || state.memory?.charts?.some(chart => chart.series?.some(trace => trace.x === output.x && trace.y === output.y))
      || state.measurement?.x === output.x && state.measurement?.y === output.y;
    return traceExists ? output : null;
  }

  function grid(title, values) {
    const section = node('section', 'trace-analysis-group'); section.append(node('h3', '', title));
    const list = node('dl');
    for (const [label, value, key] of values) {
      const pair = node('div'); pair.append(node('dt', '', label));
      const datum = node('dd', '', value); if (key) datum.dataset.quantity = key;
      pair.append(datum); list.append(pair);
    }
    section.append(list); return section;
  }

  function render(value) {
    context = value;
    const settings = panelState(value), chart = value.chart, traces = chart?.series ?? [];
    if (!traces[settings.series]) settings.series = selectedDefault(traces);
    const trace = traces[settings.series];
    const signature = JSON.stringify(traces.map((item, index) => [index, item.name]));
    if (signature !== optionKey) {
      traceSelect.replaceChildren(...traces.map((item, index) => new Option(item.name ?? 'Trace ' + (index + 1), String(index))));
      optionKey = signature;
    }
    traceSelect.value = String(settings.series);
    for (const [input, key] of [[minimum, 'min'], [maximum, 'max'], [baseline, 'baseline'], [baselineValue, 'baselineValue']]) {
      if (document.activeElement !== input) input.value = settings[key];
    }
    const xUnit = unitFrom(chart?.xLabel), yUnit = unitFrom(chart?.yLabel);
    minimum.setAttribute('aria-label', 'Lower analysis limit' + (xUnit ? ' (' + xUnit + ')' : ''));
    maximum.setAttribute('aria-label', 'Upper analysis limit' + (xUnit ? ' (' + xUnit + ')' : ''));
    baselineValue.setAttribute('aria-label', 'Constant baseline' + (yUnit ? ' (' + yUnit + ')' : ''));
    let xLow = Infinity, xHigh = -Infinity;
    for (const x of trace?.x ?? []) if (finite(x)) { xLow = Math.min(xLow, x); xHigh = Math.max(xHigh, x); }
    minimum.placeholder = finite(xLow) ? short(xLow) : '';
    maximum.placeholder = finite(xHigh) ? short(xHigh) : '';
    constantField.hidden = settings.baseline !== 'constant';
    for (const input of [traceSelect, minimum, maximum, baseline, baselineValue, run]) input.disabled = !trace;
    syncCursors(); if (!trace) cursors.disabled = true;
    const output = settings.output?.x === trace?.x && settings.output?.y === trace?.y ? settings.output : null;
    save.disabled = !output;
    summary.replaceChildren();
    status.dataset.error = String(Boolean(settings.error));
    if (!output) {
      status.textContent = settings.error || (!trace ? 'Choose a line graph for range analysis.'
        : settings.output ? 'Trace changed. Analyze the range again.' : 'Set the X range, or leave both limits blank for the full trace.');
      return chart ? [chart] : [];
    }
    const { result } = output, stats = result.statistics;
    const withUnit = (value, u) => short(value) + (u && finite(value) ? ' ' + u : '');
    const location = point => point ? withUnit(point.y, yUnit) + ' at ' + withUnit(point.x, xUnit) : '—';
    const areaUnit = [yUnit || 'signal', xUnit || 'X'].join('·');
    status.textContent = withUnit(result.range[0], xUnit) + ' to ' + withUnit(result.range[1], xUnit)
      + ' · ' + short(result.coverage * 100) + '% covered · ' + result.segments + ' continuous segment' + (result.segments === 1 ? '' : 's')
      + (result.warnings.length ? ' · ' + result.warnings.join(' ') : '');
    summary.append(grid('Observed samples', [
      ['Count', String(stats.count), 'count'], ['Mean', withUnit(stats.mean, yUnit), 'mean'],
      ['Sample SD (n−1)', withUnit(stats.sampleSD, yUnit), 'sample_sd'], ['RMS', withUnit(stats.rms, yUnit), 'rms'],
      ['Minimum', location(stats.minimum), 'minimum'], ['Maximum', location(stats.maximum), 'maximum'],
    ]), grid('Baseline-corrected integration', [
      ['Net area', withUnit(result.integral.net, areaUnit), 'net_area'],
      ['Positive area', withUnit(result.integral.positive, areaUnit), 'positive_area'],
      ['Negative area', withUnit(result.integral.negative, areaUnit), 'negative_area'],
      ['Absolute area', withUnit(result.integral.absolute, areaUnit), 'absolute_area'],
      ['Positive-area centroid', withUnit(result.integral.positiveCentroid, xUnit), 'positive_centroid'],
      ['Covered width', withUnit(result.coveredWidth, xUnit), 'covered_width'],
    ]));
    const baselineLine = { ...result.baselineCurve, name: 'Range baseline', color: '#7b5c29', dash: '5 4' };
    const displayed = settings.baseline === 'none' ? chart : { ...chart, series: [...traces, baselineLine] };
    return settings.baseline === 'none' ? [displayed] : [displayed, {
      title: chart.title + ' · baseline-corrected range', xLabel: chart.xLabel, yLabel: chart.yLabel,
      series: [{ ...result.corrected, name: output.name + ' − baseline', color: '#32653b' }],
    }];
  }

  function csvRows(result, state) {
    const output = currentAnalysis(result, state);
    if (!output) return [];
    const { id, mode, title, name, xLabel, yLabel } = output;
    const rows = analysisQuantities(output).map(([key, value, unit]) =>
      ['range_statistic', id, mode, title, name, xLabel, '', yLabel, '', '', key + (unit ? ' (' + unit + ')' : ''), value]);
    for (let index = 0; index < output.result.corrected.x.length; index++) {
      rows.push(['range_corrected', id, mode, title, name, xLabel, output.result.corrected.x[index], yLabel,
        output.result.corrected.y[index], '', 'interpolated_boundary', output.result.corrected.interpolated[index]]);
    }
    return rows;
  }

  save.addEventListener('click', () => {
    const settings = context && panelState(context), output = settings?.output;
    const trace = context?.chart?.series?.[settings?.series];
    if (!output || output.x !== trace?.x || output.y !== trace?.y) return;
    const rows = [['record', 'trace', 'x_axis', 'x', 'y_axis', 'y', 'quantity', 'value', 'unit']];
    for (const [key, value, unit] of analysisQuantities(output)) rows.push(['statistic', output.name, output.xLabel, '', output.yLabel, '', key, value, unit]);
    for (let index = 0; index < output.result.corrected.x.length; index++) rows.push([
      'corrected_signal', output.name, output.xLabel, output.result.corrected.x[index], output.yLabel, output.result.corrected.y[index],
      'interpolated_boundary', output.result.corrected.interpolated[index], '',
    ]);
    exportFile('spectral-bench-' + output.id + '-range-statistics.csv', '\uFEFF' + rows.map(row => row.map(csv).join(',')).join('\r\n'));
  });

  return { render, syncCursors, currentAnalysis, csvRows };
}
