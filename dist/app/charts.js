const svgNamespace = 'http://www.w3.org/2000/svg';
const palette = ['#205586', '#9e402c', '#32653b', '#754a8d', '#8e600b', '#006667'];
const memoryPalette = ['#4b4b4b', '#555f70', '#715743', '#566151', '#6f586e', '#655b3a'];
const heatmapColors = { negative: '#215394', neutral: '#fffef7', positive: '#a23823' };
const cursorColors = { a: '#17436b', b: '#8d3a20', preview: '#53574b' };
const chartCursors = new WeakMap();

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
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude >= 1e5 || magnitude < 0.001)) return value.toExponential(1);
  return Number(value.toPrecision(digits)).toLocaleString('en-US', { maximumFractionDigits: 6 });
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
    path += (penDown ? 'L' : 'M') + mapX(x[i]).toFixed(2) + ' ' + mapY(y[i]).toFixed(2);
    penDown = true;
  }
  return path;
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

function createPlot(container, chart, id, onProbe, cursorStore, showHint) {
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
  const key = JSON.stringify([chart.title, chart.xLabel, chart.yLabel]);
  const pins = cursorStore.get(key) ?? { a: null, b: null };
  const card = element('article', heatmap ? 'plot-card is-heatmap' : 'plot-card');
  const heading = element('div', 'plot-head');
  heading.append(element('h3', '', chart.title));
  const legend = element('div', 'plot-legend');
  heading.append(legend);
  const swatch = (name, color, dash) => {
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
  card.append(heading, chartSvg, readout);
  if (chart.note) card.append(element('p', 'plot-caption', chart.note));
  container.append(card);

  let geometry;
  let cursor;
  let pointerValue = null;
  let displayValue = null;
  let previousProbe;
  const xValues = heatmap?.x ?? series[0]?.x ?? [];
  const keyboardValues = Array.from(new Set(Array.from(xValues).filter(Number.isFinite))).sort((a, b) => a - b);
  const yValues = heatmap?.y ?? [];
  const [xMin, xMax] = plotBounds(limits(heatmap ? [xValues] : series.map(entry => entry.x)));
  const [yMin, yMax] = plotBounds(limits(heatmap ? [yValues] : series.map(entry => entry.y)), !heatmap);
  const axisUnit = label => /\(([^()]*)\)\s*$/.exec(label ?? '')?.[1];
  const formatAxis = (value, label, digits = 5) => [formatNumber(value, digits), axisUnit(label)].filter(Boolean).join(' ');

  function draw() {
    const width = Math.max(220, chartSvg.clientWidth);
    const height = chartSvg.clientHeight || 190;
    const left = 63;
    const right = width - 14;
    const top = 11;
    const bottom = height - 39;
    const mapX = value => left + (value - xMin) * (right - left) / (xMax - xMin);
    const mapY = value => bottom - (value - yMin) * (bottom - top) / (yMax - yMin);
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
      chartSvg.append(svgElement('image', {
        x: left, y: top, width: right - left, height: bottom - top,
        href: heatImage, preserveAspectRatio: 'none',
      }));
    }
    for (const value of tickValues(yMin, yMax, 4)) {
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
    grid.append(svgElement('text', { x: 12, y: (top + bottom) / 2, 'text-anchor': 'middle', transform: 'rotate(-90 12 ' + (top + bottom) / 2 + ')' }, chart.yLabel ?? ''));
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
    renderCursors();
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
      if (!Number.isFinite(value)) continue;
      values.push({ name: entry.name, x: entry.x[offset], value, color: entry.color });
    }
    return { chart: chart.title, x, y: values[0]?.value, values };
  }

  function drawCursor(point, kind) {
    if (!point) return;
    const { mapX, mapY, top, bottom, left, right } = geometry;
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
    if (heatmap) return x + ' · ' + formatAxis(point.y, chart.yLabel) + ' · ΔA ' + formatNumber(point.signal, 4);
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
    return { x: xMin + (px - left) / (right - left) * (xMax - xMin),
      y: yMin + (bottom - py) / (bottom - top) * (yMax - yMin) };
  }

  chartSvg.addEventListener('pointermove', event => {
    if (pins.a || pins.b) return;
    displayValue = null;
    pointerValue = atPointer(event);
    reportProbe(renderCursors().preview);
  });
  chartSvg.addEventListener('pointerleave', () => {
    if (pins.a || pins.b) return;
    pointerValue = null;
    displayValue = null;
    renderCursors();
    reportProbe(null);
  });
  chartSvg.addEventListener('click', event => {
    const requested = atPointer(event);
    if (!requested) return;
    chartSvg.focus({ preventScroll: true });
    pinPoint(event.shiftKey ? 'b' : 'a', requested);
  });
  chartSvg.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Enter', 'Escape'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Escape') {
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
    disconnect: () => observer.disconnect(),
    showPoint: x => {
      displayValue = { x };
      renderCursors();
    },
  };
}

export function renderCharts(container, charts, onProbe, { cursors = chartCursors.get(container) ?? new Map() } = {}) {
  chartCursors.set(container, cursors);
  container.replaceChildren();
  const plots = charts.map((chart, index) => createPlot(container, chart, container.id + '-clip-' + index, onProbe, cursors, index === 0));
  return {
    disconnect: () => plots.forEach(plot => plot.disconnect()),
    showPoint: (chart, x) => plots[chart]?.showPoint(x),
  };
}
