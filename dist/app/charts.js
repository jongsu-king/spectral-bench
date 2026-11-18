import { createFigureAsset, downloadFigure } from './figure-export.js';

const svgNamespace = 'http://www.w3.org/2000/svg';
const palette = ['#205586', '#9e402c', '#32653b', '#754a8d', '#8e600b', '#006667'];
const memoryPalette = ['#4b4b4b', '#555f70', '#715743', '#566151', '#6f586e', '#655b3a'];
const heatmapColors = { negative: '#215394', neutral: '#fffef7', positive: '#a23823' };
const cursorColors = { a: '#17436b', b: '#8d3a20', preview: '#53574b' };
const chartCursors = new WeakMap();
const chartViews = new WeakMap();

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svgElement(tag, attributes = {}, content) {
  const node = document.createElementNS(svgNamespace, tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (content !== undefined) node.textContent = content;
  return node;
}

function limits(values) {
  let low = Infinity;
  let high = -Infinity;
  for (const sequence of values) {
    for (const value of sequence ?? []) {
      if (!Number.isFinite(value)) continue;
      low = Math.min(low, value);
      high = Math.max(high, value);
    }
  }
  return low === Infinity ? [0, 1] : [low, high];
}

function plotBounds(bounds, includeZero) {
  let [min, max] = bounds;
  if (includeZero && min >= 0) min = 0;
  if (min === max) {
    const span = Math.abs(min) * 0.05 || 1;
    min -= span;
    max += span;
  }
  return [min, max];
}

function tickValues(min, max, count) {
  const target = (max - min) / count;
  const power = 10 ** Math.floor(Math.log10(target));
  const normalized = target / power;
  const step = ([1, 2, 2.5, 5, 10].find(value => value >= normalized) || 10) * power;
  const ticks = [];
  for (let value = Math.ceil(min / step) * step; value <= max + step * 1e-8; value += step) {
    ticks.push(Math.abs(value) < step * 1e-8 ? 0 : value);
  }
  return ticks;
}

export function formatNumber(value, digits = 3) {
  if (!Number.isFinite(value)) return '—';
  const precision = Number.isInteger(digits) ? Math.max(1, Math.min(12, digits)) : 3;
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude >= 1e5 || magnitude < 0.001)) return value.toExponential(precision - 1);
  return Number(value.toPrecision(precision)).toLocaleString('en-US', { maximumFractionDigits: 6 });
}

function closest(sequence, target) {
  let closestIndex = -1;
  let closestDistance = Infinity;
  for (let i = 0; i < sequence.length; i += 1) {
    if (!Number.isFinite(sequence[i])) continue;
    const distance = Math.abs(sequence[i] - target);
    if (distance < closestDistance) {
      closestIndex = i;
      closestDistance = distance;
    }
  }
  return closestIndex;
}

function linePath(x, y, mapX, mapY) {
  let path = '';
  let penDown = false;
  for (let i = 0; i < Math.min(x.length, y.length); i += 1) {
    if (!Number.isFinite(x[i]) || !Number.isFinite(y[i])) {
      penDown = false;
      continue;
    }
    const px = mapX(x[i]);
    const py = mapY(y[i]);
    if (!Number.isFinite(px) || !Number.isFinite(py)) {
      penDown = false;
      continue;
    }
    path += (penDown ? 'L' : 'M') + px.toFixed(2) + ' ' + py.toFixed(2);
    penDown = true;
  }
  return path;
}

function validRange(range, logarithmic = false) {
  if (!Array.isArray(range) || range.length !== 2 || !range.every(Number.isFinite)) return false;
  const [min, max] = range;
  const span = max - min;
  if (!(max > min) || !Number.isFinite(span)) return false;
  if (span <= Math.max(Math.abs(min), Math.abs(max)) * 1e-12) return false;
  return !logarithmic || min > 0;
}

function logarithmicBounds(series) {
  const [min, max] = limits(series.map(entry => entry.y?.filter(value => Number.isFinite(value) && value > 0)));
  if (!(min > 0)) return [0.1, 1];
  return min === max ? [min / Math.sqrt(10), max * Math.sqrt(10)] : [min, max];
}

function logarithmicTicks(min, max) {
  const first = Math.floor(Math.log10(min));
  const last = Math.ceil(Math.log10(max));
  const step = Math.max(1, Math.ceil((last - first) / 6));
  const factors = last - first <= 2 ? [1, 2, 5] : [1];
  const values = [];
  for (let exponent = first; exponent <= last; exponent += step) {
    for (const factor of factors) {
      const value = factor * 10 ** exponent;
      if (value >= min && value <= max) values.push(value);
    }
  }
  return values;
}

function heatmapImage(heatmap, amplitude) {
  const canvas = document.createElement('canvas');
  canvas.width = heatmap.x.length;
  canvas.height = heatmap.y.length;
  const context = canvas.getContext('2d');
  const image = context.createImageData(canvas.width, canvas.height);
  const ascendingX = heatmap.x[0] < heatmap.x.at(-1);
  const ascendingY = heatmap.y[0] < heatmap.y.at(-1);
  const rgb = hex => hex.slice(1).match(/../g).map(channel => parseInt(channel, 16));
  const negative = rgb(heatmapColors.negative);
  const neutral = rgb(heatmapColors.neutral);
  const positive = rgb(heatmapColors.positive);
  for (let row = 0; row < canvas.height; row += 1) {
    for (let column = 0; column < canvas.width; column += 1) {
      const value = heatmap.z[row]?.[column];
      const level = Number.isFinite(value) ? Math.min(1, Math.abs(value) / amplitude) ** 0.76 : 0;
      const endpoint = value < 0 ? negative : positive;
      const rasterX = ascendingX ? column : canvas.width - column - 1;
      const rasterY = ascendingY ? canvas.height - row - 1 : row;
      const offset = (rasterY * canvas.width + rasterX) * 4;
      for (let channel = 0; channel < 3; channel += 1) {
        image.data[offset + channel] = neutral[channel] + (endpoint[channel] - neutral[channel]) * level;
      }
      image.data[offset + 3] = 255;
    }
  }
  context.putImageData(image, 0, 0);
  return canvas.toDataURL();
}

function createPlot(container, chart, id, onProbe, cursorStore, viewStore, showHint, exportFile, notify) {
  const heatmap = chart.heatmap?.x?.length && chart.heatmap?.y?.length && chart.heatmap?.z?.length ? chart.heatmap : null;
  const series = (chart.series ?? []).map((entry, index) => {
    const colors = entry.memory ? memoryPalette : palette;
    const dashed = entry.dash ?? entry.dashed ?? entry.memory;
    return {
      ...entry,
      color: entry.color ?? colors[index % colors.length],
      dash: typeof dashed === 'string' ? dashed : dashed ? '4 4' : '',
      domain: limits([entry.x]),
    };
  });
  const hasPositiveY = series.some(entry => entry.y?.some(value => Number.isFinite(value) && value > 0));
  const hasNonpositiveY = series.some(entry => entry.y?.some(value => Number.isFinite(value) && value <= 0));
  const key = JSON.stringify([chart.title, chart.xLabel, chart.yLabel]);
  const pins = cursorStore.get(key) ?? { a: null, b: null };
  const savedView = viewStore.get(key);
  const view = {
    x: validRange(savedView?.x) ? [...savedView.x] : null,
    y: validRange(savedView?.y, savedView?.logY === true && !heatmap) ? [...savedView.y] : null,
    logY: savedView?.logY === true && !heatmap,
  };
  const card = element('article', heatmap ? 'plot-card is-heatmap' : 'plot-card');
  const heading = element('div', 'plot-head');
  heading.append(element('h3', '', chart.title));
  const legend = element('div', 'plot-legend');
  heading.append(legend);
  const figureLegend = [];
  const swatch = (name, color, dash) => {
    figureLegend.push({ name, color, dash });
    const item = element('span', 'legend-entry');
    const key = element('span', 'legend-key');
    key.style.setProperty('--series', color);
    if (dash) {
      key.style.background = 'transparent';
      key.style.borderTop = '2px dashed ' + color;
      key.style.borderRadius = '0';
    }
    item.append(key, document.createTextNode(name));
    legend.append(item);
  };
  let heatImage;
  if (heatmap) {
    const [min, max] = limits(heatmap.z);
    const amplitude = Math.max(Math.abs(min), Math.abs(max), 1e-9);
    heatImage = heatmapImage(heatmap, amplitude);
    swatch(formatNumber(-amplitude), heatmapColors.negative);
    swatch(formatNumber(amplitude), heatmapColors.positive);
  } else {
    for (const entry of series) swatch(entry.name, entry.color, entry.dash);
  }
  const chartSvg = svgElement('svg', {
    role: 'img',
    tabindex: '0',
    'aria-label': chart.title + '. Click or use arrow keys for cursor A. Hold Shift for cursor B. Escape clears both.',
    'aria-describedby': id + '-readout',
  });
  const readout = element('p', 'plot-readout');
  readout.id = id + '-readout';
  const navigation = element('div', 'plot-navigation');
  navigation.title = 'Ctrl/⌘+wheel zooms around the pointer. Add Shift for Y only. Home restores the full data limits.';
  const cursorButton = element('button', 'button', 'Cursor');
  const zoomButton = element('button', 'button', 'Zoom box');
  const autoscaleButton = element('button', 'button', 'Autoscale');
  const axesButton = element('button', 'button', 'Axes…');
  for (const button of [cursorButton, zoomButton, autoscaleButton, axesButton]) button.type = 'button';
  cursorButton.setAttribute('aria-pressed', 'true');
  zoomButton.setAttribute('aria-pressed', 'false');
  zoomButton.title = 'Drag a rectangle to set X and Y limits';
  autoscaleButton.title = 'Restore the full data limits';
  axesButton.setAttribute('aria-expanded', 'false');
  const navigationStatus = element('output', 'plot-navigation-status');
  navigationStatus.setAttribute('aria-live', 'polite');
  const figureActions = element('span', 'plot-figure-actions');
  const figureStatus = element('output', 'plot-figure-status');
  figureStatus.setAttribute('aria-live', 'polite');
  const figureButtons = ['svg', 'png'].map(format => {
    const button = element('button', 'button', format.toUpperCase());
    button.type = 'button';
    button.classList.add('plot-export-' + format);
    button.title = 'Save ' + chart.title + ' as ' + format.toUpperCase() + ' with the current axis limits';
    button.setAttribute('aria-label', 'Save ' + format.toUpperCase() + ' figure · ' + chart.title);
    button.addEventListener('click', async () => {
      figureButtons.forEach(entry => { entry.disabled = true; });
      figureStatus.textContent = 'Preparing ' + format.toUpperCase() + '…';
      figureStatus.dataset.error = 'false';
      try {
        const asset = await createFigureAsset(chartSvg, { title: chart.title, legend: figureLegend, note: chart.note,
          xLabel: chart.xLabel, yLabel: chart.yLabel, zLabel: heatmap?.zLabel ?? (heatmap ? 'ΔA (mOD)' : '') }, format);
        if (exportFile) await exportFile(asset.filename, asset.content, { mimeType: asset.mimeType, encoding: asset.encoding });
        else downloadFigure(asset);
        figureStatus.textContent = '';
      } catch (error) {
        figureStatus.textContent = error.message || 'The figure could not be exported.';
        figureStatus.dataset.error = 'true';
        notify?.(figureStatus.textContent);
      } finally { figureButtons.forEach(entry => { entry.disabled = false; }); }
    });
    return button;
  });
  figureActions.append(...figureButtons);
  navigation.append(cursorButton, zoomButton, autoscaleButton, axesButton, navigationStatus, figureActions, figureStatus);
  const axisForm = element('form', 'plot-axis-form');
  axisForm.hidden = true;
  axisForm.id = id + '-axes';
  axesButton.setAttribute('aria-controls', axisForm.id);
  const fields = new Map();
  for (const [name, label] of [['xMin', 'X from'], ['xMax', 'X to'], ['yMin', 'Y from'], ['yMax', 'Y to']]) {
    const field = element('label', '', label);
    const input = element('input');
    input.type = 'number';
    input.step = 'any';
    input.name = name;
    input.required = true;
    input.setAttribute('aria-label', label + ' · ' + (name.startsWith('x') ? chart.xLabel ?? 'X' : chart.yLabel ?? 'Y'));
    fields.set(name, input);
    field.append(input);
    axisForm.append(field);
  }
  const logLabel = element('label', 'plot-log-option');
  const logInput = element('input');
  logInput.type = 'checkbox';
  logInput.name = 'logY';
  logInput.disabled = Boolean(heatmap);
  logInput.title = 'Logarithmic Y scale displays positive samples';
  logLabel.append(logInput, 'Log Y');
  if (heatmap) logLabel.hidden = true;
  const applyAxesButton = element('button', 'button', 'Apply');
  applyAxesButton.type = 'submit';
  const cancelAxesButton = element('button', 'button', 'Cancel');
  cancelAxesButton.type = 'button';
  const axisError = element('output', 'plot-axis-error');
  axisError.setAttribute('aria-live', 'polite');
  axisForm.append(logLabel, applyAxesButton, cancelAxesButton, axisError);
  card.append(heading, navigation, axisForm, chartSvg, readout);
  if (chart.note) card.append(element('p', 'plot-caption', chart.note));
  container.append(card);

  let geometry;
  let cursor;
  let pointerValue = null;
  let displayValue = null;
  let previousProbe;
  let zoomMode = false;
  let drag;
  let zoomBox;
  let ignoreClick = false;
  const xValues = heatmap?.x ?? series[0]?.x ?? [];
  const keyboardValues = Array.from(new Set(Array.from(xValues).filter(Number.isFinite))).sort((a, b) => a - b);
  const yValues = heatmap?.y ?? [];
  const naturalX = plotBounds(limits(heatmap ? [xValues] : series.map(entry => entry.x)));
  const naturalY = plotBounds(limits(heatmap ? [yValues] : series.map(entry => entry.y)), !heatmap);
  let xMin, xMax, yMin, yMax;
  const axisUnit = label => /\(([^()]*)\)\s*$/.exec(label ?? '')?.[1];
  const formatAxis = (value, label, digits = 5) => [formatNumber(value, digits), axisUnit(label)].filter(Boolean).join(' ');

  function draw() {
    [xMin, xMax] = view.x ?? naturalX;
    [yMin, yMax] = view.y ?? (view.logY ? logarithmicBounds(series) : naturalY);
    const width = Math.max(220, chartSvg.clientWidth);
    const height = chartSvg.clientHeight || 190;
    const left = 63;
    const right = width - 14;
    const top = 11;
    const bottom = height - 39;
    const mapX = value => left + (value - xMin) * (right - left) / (xMax - xMin);
    const transformedMin = view.logY ? Math.log10(yMin) : yMin;
    const transformedMax = view.logY ? Math.log10(yMax) : yMax;
    const mapY = value => bottom - ((view.logY ? value > 0 ? Math.log10(value) : NaN : value) - transformedMin) *
      (bottom - top) / (transformedMax - transformedMin);
    geometry = { width, height, left, right, top, bottom, mapX, mapY };
    chartSvg.replaceChildren();
    chartSvg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
    const defs = svgElement('defs');
    const clip = svgElement('clipPath', { id });
    clip.append(svgElement('rect', { x: left, y: top, width: right - left, height: bottom - top }));
    defs.append(clip);
    chartSvg.append(defs);

    const grid = svgElement('g', { fill: 'var(--muted)', 'font-size': 9.5, 'font-family': 'var(--mono)' });
    chartSvg.append(svgElement('rect', {
      class: 'plot-area', x: left, y: top, width: right - left, height: bottom - top, fill: 'var(--plot-area, #fffef7)',
    }));
    if (heatmap) {
      const imageLayer = svgElement('g', { 'clip-path': 'url(#' + id + ')' });
      imageLayer.append(svgElement('image', {
        x: mapX(naturalX[0]), y: mapY(naturalY[1]),
        width: mapX(naturalX[1]) - mapX(naturalX[0]), height: mapY(naturalY[0]) - mapY(naturalY[1]),
        href: heatImage, preserveAspectRatio: 'none',
      }));
      chartSvg.append(imageLayer);
    }
    for (const value of view.logY ? logarithmicTicks(yMin, yMax) : tickValues(yMin, yMax, 4)) {
      const y = mapY(value);
      grid.append(svgElement('line', { x1: left, x2: right, y1: y, y2: y, stroke: 'var(--chart-grid)', opacity: heatmap ? 0.55 : 1 }));
      grid.append(svgElement('text', { x: left - 7, y: y + 3, 'text-anchor': 'end' }, formatNumber(value)));
    }
    for (const value of tickValues(xMin, xMax, width < 380 ? 4 : 6)) {
      const x = mapX(value);
      grid.append(svgElement('line', { x1: x, x2: x, y1: top, y2: bottom, stroke: 'var(--chart-grid)', opacity: heatmap ? 0.55 : 1 }));
      grid.append(svgElement('text', { x, y: bottom + 14, 'text-anchor': 'middle' }, formatNumber(value)));
    }
    grid.append(svgElement('rect', { x: left, y: top, width: right - left, height: bottom - top,
      fill: 'none', stroke: 'var(--quiet)', 'stroke-opacity': 0.65 }));
    grid.append(svgElement('text', { x: (left + right) / 2, y: height - 5, 'text-anchor': 'middle' }, chart.xLabel ?? ''));
    grid.append(svgElement('text', { x: 12, y: (top + bottom) / 2, 'text-anchor': 'middle', transform: 'rotate(-90 12 ' + (top + bottom) / 2 + ')' },
      (chart.yLabel ?? '') + (view.logY ? ' · log' : '')));
    chartSvg.append(grid);

    const traces = svgElement('g', { 'clip-path': 'url(#' + id + ')' });
    for (const entry of series) {
      traces.append(svgElement('path', {
        d: linePath(entry.x, entry.y, mapX, mapY),
        fill: 'none',
        stroke: entry.color,
        'stroke-width': entry.dash ? 1.45 : 1.65,
        'stroke-dasharray': entry.dash,
        'vector-effect': 'non-scaling-stroke',
        'stroke-linejoin': 'round',
      }));
    }
    chartSvg.append(traces);
    cursor = svgElement('g', { class: 'plot-cursor', 'aria-hidden': 'true' });
    chartSvg.append(cursor);
    zoomBox = svgElement('rect', { class: 'plot-zoom-box', visibility: 'hidden', fill: '#31648f18',
      stroke: '#31648f', 'stroke-dasharray': '3 2', 'pointer-events': 'none' });
    chartSvg.append(zoomBox);
    renderCursors();
    updateNavigationStatus();
  }

  function resolvePoint(requested) {
    if (!requested) return null;
    const index = closest(xValues, requested.x);
    if (index < 0) return null;
    const x = xValues[index];
    if (heatmap) {
      const row = closest(yValues, requested.y ?? yValues[Math.floor(yValues.length / 2)]);
      if (row < 0) return null;
      const y = yValues[row];
      const signal = heatmap.z[row]?.[index];
      return { chart: chart.title, x, y, signal };
    }
    const values = [];
    for (const entry of series) {
      if (x < entry.domain[0] || x > entry.domain[1]) continue;
      const offset = closest(entry.x, x);
      const value = entry.y[offset];
      if (!Number.isFinite(value) || (view.logY && value <= 0)) continue;
      values.push({ name: entry.name, x: entry.x[offset], value, color: entry.color });
    }
    return { chart: chart.title, x, y: values[0]?.value, values };
  }

  function drawCursor(point, kind) {
    if (!point) return;
    const { mapX, mapY, top, bottom, left, right } = geometry;
    if (point.x < xMin || point.x > xMax || (heatmap && (point.y < yMin || point.y > yMax))) return;
    const color = cursorColors[kind];
    const x = mapX(point.x);
    const strokeDash = kind === 'a' ? '' : kind === 'b' ? '5 3' : '2 3';
    const vertical = { x1: x, x2: x, y1: top, y2: bottom };
    const stroke = { stroke: color, 'stroke-dasharray': strokeDash };
    if (heatmap) {
      const y = mapY(point.y);
      const horizontal = { x1: left, x2: right, y1: y, y2: y };
      const halo = { stroke: '#fffef7', 'stroke-width': 2.8, 'stroke-opacity': 0.8, 'stroke-dasharray': strokeDash };
      cursor.append(svgElement('line', { ...vertical, ...halo }), svgElement('line', { ...horizontal, ...halo }),
        svgElement('line', { ...vertical, ...stroke }), svgElement('line', { ...horizontal, ...stroke }));
    } else {
      cursor.append(svgElement('line', { ...vertical, ...stroke }));
      for (const sample of point.values) {
        if (sample.value < yMin || sample.value > yMax || !Number.isFinite(mapY(sample.value))) continue;
        cursor.append(svgElement('circle', { cx: mapX(sample.x), cy: mapY(sample.value), r: 2.7, fill: sample.color,
          stroke: 'var(--plot-area, #fffef7)', 'stroke-width': 0.8 }));
      }
    }
    if (kind !== 'preview') {
      const labelX = x > right - 12 || (kind === 'a' && x > left + 12) ? x - 7 : x + 7;
      cursor.append(svgElement('rect', { x: labelX - 5.5, y: top + 2, width: 11, height: 13, rx: 1, fill: color }),
        svgElement('text', { x: labelX, y: top + 12, fill: 'white', 'text-anchor': 'middle', 'font-size': 9,
          'font-family': 'var(--mono)' }, kind.toUpperCase()));
    }
  }

  function pointText(point) {
    const x = formatAxis(point.x, chart.xLabel);
    if (heatmap) return x + ' · ' + formatAxis(point.y, chart.yLabel) + ' · ' + (heatmap.zLabel ?? 'ΔA') + ' ' + formatNumber(point.signal, 4);
    const values = point.values.map(({ name, value }) => name + ' ' + formatNumber(value, 4));
    return [x, ...values].join(' · ');
  }

  function renderCursors() {
    const a = resolvePoint(pins.a);
    const b = resolvePoint(pins.b);
    const preview = resolvePoint(displayValue ?? (a || b ? null : pointerValue));
    cursor.replaceChildren();
    drawCursor(a, 'a');
    drawCursor(b, 'b');
    drawCursor(preview, 'preview');
    readout.classList.toggle('has-cursors', Boolean(a || b));
    readout.replaceChildren();
    if (a) readout.append(element('span', 'cursor-a', 'A  ' + pointText(a)));
    if (b) readout.append(element('span', 'cursor-b', 'B  ' + pointText(b)));
    if (a && b) {
      const deltaX = 'Δx  ' + formatAxis(b.x - a.x, chart.xLabel);
      const deltaY = heatmap ? '  ·  Δy  ' + formatAxis(b.y - a.y, chart.yLabel) : '';
      readout.append(element('span', 'cursor-delta', deltaX + deltaY));
    }
    if (preview) readout.append(element('span', 'cursor-preview', pointText(preview)));
    if (!a && !b && !preview && showHint && keyboardValues.length) {
      readout.append(element('span', 'cursor-hint', 'Click for A · Shift-click for B · Esc clears'));
    }
    return { a, b, preview };
  }

  function reportProbe(point) {
    if ((!point && !previousProbe) || (point && point.x === previousProbe?.x && point.y === previousProbe?.y)) return;
    previousProbe = point;
    onProbe?.(point ? { chart: point.chart, x: point.x, y: point.y } : null);
  }

  function pinPoint(kind, requested) {
    const point = resolvePoint(requested);
    if (!point) return;
    pins[kind] = { x: point.x, y: point.y };
    displayValue = null;
    cursorStore.set(key, pins);
    renderCursors();
    reportProbe(point);
  }

  function atPointer(event) {
    const bounds = chartSvg.getBoundingClientRect();
    const { width, height, left, right, top, bottom } = geometry;
    if (!bounds.width || !bounds.height) return null;
    const px = (event.clientX - bounds.left) * width / bounds.width;
    const py = (event.clientY - bounds.top) * height / bounds.height;
    if (px < left || px > right || py < top || py > bottom) return null;
    return pointAtPixel(px, py);
  }

  function pointAtPixel(px, py) {
    const { left, right, top, bottom } = geometry;
    const fraction = (bottom - py) / (bottom - top);
    return {
      x: xMin + (px - left) / (right - left) * (xMax - xMin),
      y: view.logY ? 10 ** (Math.log10(yMin) + fraction * (Math.log10(yMax) - Math.log10(yMin)))
        : yMin + fraction * (yMax - yMin),
    };
  }

  function pointerPixel(event) {
    const bounds = chartSvg.getBoundingClientRect();
    return {
      x: (event.clientX - bounds.left) * geometry.width / bounds.width,
      y: (event.clientY - bounds.top) * geometry.height / bounds.height,
    };
  }

  function updateNavigationStatus() {
    const labels = [];
    if (view.x || view.y) labels.push('Custom limits');
    if (view.logY) {
      labels.push('Log Y');
      if (!hasPositiveY) labels.push('No positive samples');
      else if (hasNonpositiveY) labels.push('Nonpositive samples hidden');
    }
    navigationStatus.textContent = labels.join(' · ');
    chartSvg.dataset.xMin = xMin;
    chartSvg.dataset.xMax = xMax;
    chartSvg.dataset.yMin = yMin;
    chartSvg.dataset.yMax = yMax;
    chartSvg.dataset.logY = String(view.logY);
  }

  function storeView() {
    viewStore.set(key, { x: view.x && [...view.x], y: view.y && [...view.y], logY: view.logY });
    pointerValue = null;
    displayValue = null;
    draw();
  }

  function setZoomMode(active) {
    zoomMode = active;
    cursorButton.setAttribute('aria-pressed', String(!active));
    zoomButton.setAttribute('aria-pressed', String(active));
    chartSvg.classList.toggle('is-zooming', active);
    cancelDrag();
  }

  function cancelDrag() {
    if (!drag) return;
    const pointer = drag.pointer;
    drag = null;
    zoomBox?.setAttribute('visibility', 'hidden');
    try { chartSvg.releasePointerCapture(pointer); } catch { /* Capture can end before cancellation. */ }
  }

  function autoscale() {
    cancelDrag();
    view.x = null;
    view.y = null;
    storeView();
  }

  function closeAxes() {
    axisForm.hidden = true;
    axesButton.setAttribute('aria-expanded', 'false');
    axisError.textContent = '';
  }

  cursorButton.addEventListener('click', () => setZoomMode(false));
  zoomButton.addEventListener('click', () => setZoomMode(true));
  autoscaleButton.addEventListener('click', autoscale);
  axesButton.addEventListener('click', () => {
    if (!axisForm.hidden) { closeAxes(); return; }
    const values = { xMin, xMax, yMin, yMax };
    for (const [name, field] of fields) field.value = values[name];
    logInput.checked = view.logY;
    axisForm.hidden = false;
    axesButton.setAttribute('aria-expanded', 'true');
    fields.get('xMin').focus();
  });
  cancelAxesButton.addEventListener('click', closeAxes);
  axisForm.addEventListener('submit', event => {
    event.preventDefault();
    const x = [fields.get('xMin').valueAsNumber, fields.get('xMax').valueAsNumber];
    const y = [fields.get('yMin').valueAsNumber, fields.get('yMax').valueAsNumber];
    const logY = logInput.checked && !heatmap;
    if (!validRange(x) || !validRange(y, logY)) {
      axisError.textContent = logY ? 'Enter increasing finite limits. Log Y requires a positive lower limit.'
        : 'Enter increasing finite limits with a nonzero range.';
      return;
    }
    view.x = x;
    view.y = y;
    view.logY = logY;
    closeAxes();
    storeView();
  });
  logInput.addEventListener('change', () => {
    if (!logInput.checked || fields.get('yMin').valueAsNumber > 0) return;
    const bounds = logarithmicBounds(series);
    fields.get('yMin').value = bounds[0];
    fields.get('yMax').value = bounds[1];
  });

  chartSvg.addEventListener('pointerdown', event => {
    if (!zoomMode || event.button !== 0 || !atPointer(event)) return;
    const start = pointerPixel(event);
    drag = { pointer: event.pointerId, start, end: start };
    chartSvg.focus({ preventScroll: true });
    try { chartSvg.setPointerCapture(event.pointerId); } catch { /* Synthetic events may have no capture. */ }
    event.preventDefault();
  });

  chartSvg.addEventListener('pointerup', event => {
    if (!drag || event.pointerId !== drag.pointer) return;
    const { start, end } = drag;
    cancelDrag();
    ignoreClick = true;
    setTimeout(() => { ignoreClick = false; }, 0);
    if (Math.abs(end.x - start.x) < 5 || Math.abs(end.y - start.y) < 5) return;
    const a = pointAtPixel(start.x, start.y);
    const b = pointAtPixel(end.x, end.y);
    const x = [Math.min(a.x, b.x), Math.max(a.x, b.x)];
    const y = [Math.min(a.y, b.y), Math.max(a.y, b.y)];
    if (!validRange(x) || !validRange(y, view.logY)) return;
    view.x = x;
    view.y = y;
    storeView();
  });
  chartSvg.addEventListener('pointercancel', cancelDrag);
  chartSvg.addEventListener('lostpointercapture', cancelDrag);

  chartSvg.addEventListener('wheel', event => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const point = atPointer(event);
    if (!point) return;
    event.preventDefault();
    const factor = Math.exp(Math.max(-0.8, Math.min(0.8, event.deltaY * 0.002)));
    zoomAround(point, factor, event.shiftKey);
  }, { passive: false });

  function zoomAround(point, factor, onlyY = false) {
    const x = onlyY ? view.x : [point.x + (xMin - point.x) * factor, point.x + (xMax - point.x) * factor];
    const y = view.logY
      ? [10 ** (Math.log10(point.y) + (Math.log10(yMin) - Math.log10(point.y)) * factor),
        10 ** (Math.log10(point.y) + (Math.log10(yMax) - Math.log10(point.y)) * factor)]
      : [point.y + (yMin - point.y) * factor, point.y + (yMax - point.y) * factor];
    if ((!onlyY && !validRange(x)) || !validRange(y, view.logY)) return;
    view.x = x;
    view.y = y;
    storeView();
  }

  chartSvg.addEventListener('pointermove', event => {
    if (drag) {
      const point = pointerPixel(event);
      const { left, right, top, bottom } = geometry;
      drag.end = { x: Math.max(left, Math.min(right, point.x)), y: Math.max(top, Math.min(bottom, point.y)) };
      const x = Math.min(drag.start.x, drag.end.x);
      const y = Math.min(drag.start.y, drag.end.y);
      zoomBox.setAttribute('x', x);
      zoomBox.setAttribute('y', y);
      zoomBox.setAttribute('width', Math.abs(drag.end.x - drag.start.x));
      zoomBox.setAttribute('height', Math.abs(drag.end.y - drag.start.y));
      zoomBox.setAttribute('visibility', 'visible');
      return;
    }
    if (zoomMode) return;
    if (pins.a || pins.b) return;
    displayValue = null;
    pointerValue = atPointer(event);
    reportProbe(renderCursors().preview);
  });
  chartSvg.addEventListener('pointerleave', () => {
    if (drag) return;
    if (pins.a || pins.b) return;
    pointerValue = null;
    displayValue = null;
    renderCursors();
    reportProbe(null);
  });
  chartSvg.addEventListener('click', event => {
    if (ignoreClick) { ignoreClick = false; return; }
    if (zoomMode) return;
    const requested = atPointer(event);
    if (!requested) return;
    chartSvg.focus({ preventScroll: true });
    pinPoint(event.shiftKey ? 'b' : 'a', requested);
  });
  chartSvg.addEventListener('keydown', event => {
    if (event.key === 'Home') { event.preventDefault(); autoscale(); return; }
    if (event.key === '+' || event.key === '=' || event.key === '-') {
      event.preventDefault();
      zoomAround({ x: (xMin + xMax) / 2, y: view.logY ? Math.sqrt(yMin * yMax) : (yMin + yMax) / 2 }, event.key === '-' ? 1.25 : 0.8);
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'Enter', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Escape') {
      if (drag || zoomMode) { cancelDrag(); setZoomMode(false); return; }
      pins.a = null;
      pins.b = null;
      pointerValue = null;
      displayValue = null;
      cursorStore.delete(key);
      renderCursors();
      previousProbe = undefined;
      onProbe?.(null);
      return;
    }
    const kind = event.shiftKey ? 'b' : 'a';
    const requested = pins[kind] ?? pointerValue ?? displayValue;
    const index = closest(keyboardValues, requested?.x ?? (xMin + xMax) / 2);
    if (index < 0) return;
    const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const next = Math.min(keyboardValues.length - 1, Math.max(0, index + direction));
    pinPoint(kind, { x: keyboardValues[next], y: requested?.y });
  });
  draw();
  const observer = new ResizeObserver(draw);
  observer.observe(chartSvg);
  return {
    disconnect: () => { cancelDrag(); observer.disconnect(); },
    showPoint: (x, y) => {
      displayValue = { x, y };
      renderCursors();
    },
  };
}

export function renderCharts(container, charts, onProbe, {
  cursors = chartCursors.get(container) ?? new Map(),
  views = chartViews.get(container) ?? new Map(),
  exportFile, notify,
} = {}) {
  chartCursors.set(container, cursors);
  chartViews.set(container, views);
  container.replaceChildren();
  const plots = charts.map((chart, index) => createPlot(container, chart, container.id + '-clip-' + index, onProbe, cursors, views, index === 0, exportFile, notify));
  return {
    disconnect: () => plots.forEach(plot => plot.disconnect()),
    showPoint: (chart, x, y) => plots[chart]?.showPoint(x, y),
  };
}
