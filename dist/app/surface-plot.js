const plots = new WeakMap();
const initialView = { yaw: 0.68, pitch: 0.61, zoom: 1 };
const maxMeshCells = 1800;
const sequential = [[45, 55, 106], [41, 105, 150], [50, 153, 153], [143, 181, 112], [236, 204, 84]];
const diverging = [[39, 80, 145], [132, 173, 205], [246, 246, 242], [210, 130, 103], [153, 60, 39]];

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function domain(values) {
  let low = Infinity;
  let high = -Infinity;
  for (const value of values) if (Number.isFinite(value)) {
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  return { low, high };
}

function scale(value, bounds) {
  return bounds.high === bounds.low ? 0 : (value - bounds.low) / (bounds.high - bounds.low) - 0.5;
}

function numberText(value) {
  return Number.isFinite(value) ? String(Number(value.toPrecision(4))) : '';
}

function color(value, bounds, colors) {
  const position = (scale(value, bounds) + 0.5) * (colors.length - 1);
  const index = clamp(Math.floor(position), 0, colors.length - 2);
  const mix = clamp(position - index, 0, 1);
  const channels = colors[index].map((channel, i) => Math.round(channel + mix * (colors[index + 1][i] - channel)));
  return `rgb(${channels.join(',')})`;
}

function sampledIndices(length, stride) {
  const indices = [];
  for (let index = 0; index < length - 1; index += stride) indices.push(index);
  indices.push(length - 1);
  return indices;
}

function prepareSurface(data) {
  const { x, y, z } = data ?? {};
  if (!(x?.length >= 2 && y?.length >= 2 && z?.length)) return null;
  const xBounds = domain(x);
  const yBounds = domain(y);
  if (!(xBounds.low < xBounds.high) || !(yBounds.low < yBounds.high)) return null;

  let low = Infinity;
  let high = -Infinity;
  let count = 0;
  const validSample = (row, column) => Number.isFinite(x[column]) &&
    Number.isFinite(y[row]) && Number.isFinite(z[row]?.[column]);
  for (let row = 0; row < y.length; row += 1) {
    for (let column = 0; column < x.length; column += 1) if (validSample(row, column)) {
      low = Math.min(low, z[row][column]);
      high = Math.max(high, z[row][column]);
      count += 1;
    }
  }
  if (!count) return null;

  const zBounds = { low, high };
  const balanced = low < 0 && high > 0;
  const limit = Math.max(Math.abs(low), Math.abs(high));
  const colorBounds = balanced ? { low: -limit, high: limit } : zBounds;
  const palette = balanced ? diverging : sequential;
  const cellsX = x.length - 1;
  const cellsY = y.length - 1;
  const density = Math.sqrt(maxMeshCells / (cellsX * cellsY));
  const rowBudget = clamp(Math.floor(cellsY * density), 1, Math.min(cellsY, maxMeshCells));
  const columnBudget = clamp(Math.floor(maxMeshCells / rowBudget), 1, cellsX);
  const columnStride = Math.ceil(cellsX / columnBudget);
  const rowStride = Math.ceil(cellsY / rowBudget);
  const columns = sampledIndices(x.length, columnStride);
  const rows = sampledIndices(y.length, rowStride);
  const faces = [];
  const vertex = (row, column) => [
    scale(x[column], xBounds), scale(y[row], yBounds), 0.66 * scale(z[row][column], zBounds),
  ];

  for (let row = 1; row < rows.length; row += 1) {
    const top = rows[row - 1];
    const bottom = rows[row];
    for (let column = 1; column < columns.length; column += 1) {
      const left = columns[column - 1];
      const right = columns[column];
      let valid = true;
      // A coarser facet still checks every underlying sample so it cannot bridge a masked region.
      for (let i = top; valid && i <= bottom; i += 1) {
        for (let j = left; j <= right; j += 1) if (!validSample(i, j)) {
          valid = false;
          break;
        }
      }
      if (!valid) continue;
      const a = vertex(top, left);
      const b = vertex(top, right);
      const c = vertex(bottom, right);
      const d = vertex(bottom, left);
      const middle = z[top][left] + z[bottom][right];
      faces.push(
        { vertices: [a, b, c], fill: color((middle + z[top][right]) / 3, colorBounds, palette) },
        { vertices: [a, c, d], fill: color((middle + z[bottom][left]) / 3, colorBounds, palette) },
      );
    }
  }
  return {
    xBounds, yBounds, zBounds, colorBounds, palette, faces,
    count, masked: x.length * y.length - count, reduced: columnStride > 1 || rowStride > 1,
    xLabel: data.xLabel ?? 'X',
    yLabel: data.yLabel ?? 'Y',
    zLabel: data.zLabel ?? 'Value',
  };
}

function projection(width, height, view) {
  const sine = Math.sin(view.yaw);
  const cosine = Math.cos(view.yaw);
  const incline = Math.sin(view.pitch);
  const rise = Math.cos(view.pitch);
  const margin = width < 480 ? 66 : 91;
  const availableWidth = width - margin;
  const span = Math.abs(sine) + Math.abs(cosine);
  const verticalSpan = incline * span + rise * 0.66;
  const size = Math.min(availableWidth * 0.81 / span, height * 0.78 / verticalSpan) * view.zoom;
  const cx = availableWidth / 2;
  const cy = height / 2 - 10;
  return ([x, y, z]) => {
    const depth = x * sine + y * cosine;
    return {
      x: cx + size * (x * cosine - y * sine),
      y: cy - size * (depth * incline + z * rise),
      depth: depth * rise - z * incline,
    };
  };
}

function stroke(ctx, first, last, paint = '#a4adb1') {
  ctx.strokeStyle = paint;
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  ctx.lineTo(last.x, last.y);
  ctx.stroke();
}

function fractionAt(bounds, fraction) {
  return bounds.low + (bounds.high - bounds.low) * fraction;
}

function drawAxis(ctx, project, start, end, bounds, label, center, cornerFraction) {
  const a = project(start);
  const b = project(end);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  if (length < 2) return;
  const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  let nx = -(b.y - a.y) / length;
  let ny = (b.x - a.x) / length;
  if (nx * (middle.x - center.x) + ny * (middle.y - center.y) < 0) {
    nx = -nx;
    ny = -ny;
  }
  stroke(ctx, a, b, '#59656a');
  ctx.font = '11px ui-monospace, monospace';
  ctx.fillStyle = '#253237';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const divisions = length < 155 ? 2 : 4;
  const ticks = bounds.low === bounds.high ? [0.5] : Array.from({ length: divisions + 1 }, (_, i) => i / divisions);
  for (const fraction of ticks) {
    const point = { x: a.x + fraction * (b.x - a.x), y: a.y + fraction * (b.y - a.y) };
    stroke(ctx, point, { x: point.x + nx * 4, y: point.y + ny * 4 }, '#59656a');
    const offset = fraction === cornerFraction ? (fraction === 0 ? 12 : -12) / length : 0;
    ctx.fillText(numberText(fractionAt(bounds, fraction)),
      point.x + nx * 15 + offset * (b.x - a.x),
      point.y + ny * 15 + offset * (b.y - a.y));
  }
  if (label) {
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(label, middle.x + nx * 32, middle.y + ny * 32, Math.max(length, 100));
  }
}

function drawLegend(ctx, width, height, surface, meshRight) {
  const x = Math.min(width - (width < 480 ? 55 : 72), meshRight + 52);
  const length = Math.floor(Math.min(330, height - 90));
  const top = Math.round((height - length) / 2);
  const bottom = top + length;
  const { colorBounds, palette } = surface;
  for (let pixel = 0; pixel < length; pixel += 1) {
    const value = fractionAt(colorBounds, 1 - pixel / Math.max(1, length - 1));
    ctx.fillStyle = color(value, colorBounds, palette);
    ctx.fillRect(x, top + pixel, 12, 1);
  }
  ctx.strokeStyle = '#7f8b90';
  ctx.strokeRect(x, top, 12, length);
  ctx.fillStyle = '#253237';
  ctx.font = '11px system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(surface.zLabel, Math.min(x + 49, width - 8), top - 17, 99);
  ctx.textAlign = 'left';
  ctx.font = '10px ui-monospace, monospace';
  const ticks = colorBounds.high === colorBounds.low ? [0.5] : [0, 0.25, 0.5, 0.75, 1];
  for (const fraction of ticks) {
    const y = bottom - length * fraction;
    stroke(ctx, { x: x + 12, y }, { x: x + 16, y }, '#7f8b90');
    ctx.fillText(numberText(fractionAt(colorBounds, fraction)), x + 19, y, Math.min(53, width - x - 22));
  }
}

function drawSurface(ctx, width, height, view, surface) {
  const project = projection(width, height, view);
  const floor = -0.33;
  for (let index = 0; index <= 4; index += 1) {
    const coordinate = index / 4 - 0.5;
    stroke(ctx, project([-0.5, coordinate, floor]), project([0.5, coordinate, floor]), '#d1d8da');
    stroke(ctx, project([coordinate, -0.5, floor]), project([coordinate, 0.5, floor]), '#d1d8da');
  }

  const faces = surface.faces.map(face => {
    const points = face.vertices.map(project);
    const depth = points.reduce((sum, point) => sum + point.depth, 0);
    return { points, depth, fill: face.fill };
  });
  faces.sort((first, second) => second.depth - first.depth);
  ctx.lineWidth = 0.45;
  ctx.strokeStyle = '#273c4640';
  for (const face of faces) {
    ctx.beginPath();
    ctx.moveTo(face.points[0].x, face.points[0].y);
    for (const point of face.points.slice(1)) ctx.lineTo(point.x, point.y);
    ctx.closePath();
    ctx.fillStyle = face.fill;
    ctx.fill();
    ctx.stroke();
  }
  ctx.lineWidth = 1;

  const nearX = Math.sin(view.yaw) > 0 ? -0.5 : 0.5;
  const nearY = Math.cos(view.yaw) > 0 ? -0.5 : 0.5;
  const center = project([0, 0, floor]);
  const corners = [[-0.5, -0.5], [-0.5, 0.5], [0.5, -0.5], [0.5, 0.5]];
  const positioned = corners.map(pair => ({ pair, x: project([...pair, floor]).x })).sort((first, second) => first.x - second.x);
  const [sideX, sideY] = positioned[0].pair;
  drawAxis(ctx, project, [-0.5, nearY, floor], [0.5, nearY, floor], surface.xBounds, surface.xLabel, center, nearX + 0.5);
  drawAxis(ctx, project, [nearX, -0.5, floor], [nearX, 0.5, floor], surface.yBounds, surface.yLabel, center, nearY + 0.5);
  drawAxis(ctx, project, [sideX, sideY, floor], [sideX, sideY, 0.33], surface.zBounds, '', center);
  drawLegend(ctx, width, height, surface, positioned.at(-1).x);
}

function createPlot(container) {
  const toolbar = document.createElement('div');
  toolbar.className = 'surface-toolbar';
  const range = document.createElement('output');
  range.className = 'surface-range';
  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.className = 'button';
  resetButton.textContent = 'Reset view';
  toolbar.append(range, resetButton);

  const canvas = document.createElement('canvas');
  canvas.className = 'surface-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-description', 'Drag or use the arrow keys to rotate. Use the wheel or plus and minus keys to zoom. Press zero to reset.');
  container.replaceChildren(toolbar, canvas);
  const ctx = canvas.getContext('2d');
  const events = new AbortController();
  const options = { signal: events.signal };
  const view = { ...initialView };
  let surface = null;
  let lastData;
  let drag;
  let frame = 0;

  function draw() {
    frame = 0;
    const { width, height } = canvas.getBoundingClientRect();
    if (!ctx || width < 90 || height < 90) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const pixelsWide = Math.round(width * ratio);
    const pixelsHigh = Math.round(height * ratio);
    if (canvas.width !== pixelsWide) canvas.width = pixelsWide;
    if (canvas.height !== pixelsHigh) canvas.height = pixelsHigh;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = '#fcfcfb';
    ctx.fillRect(0, 0, width, height);
    if (surface?.faces.length) {
      drawSurface(ctx, width, height, view, surface);
    } else {
      ctx.fillStyle = '#566166';
      ctx.font = '13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('No continuous surface in the sampled region.', width / 2, height / 2);
    }
  }

  function invalidate() {
    if (!frame) frame = requestAnimationFrame(draw);
  }

  function reset() {
    Object.assign(view, initialView);
    invalidate();
  }

  function zoom(factor) {
    view.zoom = clamp(view.zoom * factor, 0.64, 2.8);
    invalidate();
  }

  resetButton.addEventListener('click', reset, options);
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !surface?.faces.length) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, yaw: view.yaw, pitch: view.pitch };
    canvas.setPointerCapture(event.pointerId);
    canvas.focus({ preventScroll: true });
    canvas.classList.add('is-dragging');
  }, options);
  canvas.addEventListener('pointermove', event => {
    if (event.pointerId !== drag?.id) return;
    view.yaw = drag.yaw + (event.clientX - drag.x) * 0.009;
    view.pitch = clamp(drag.pitch - (event.clientY - drag.y) * 0.008, 0.14, 1.45);
    invalidate();
  }, options);
  canvas.addEventListener('lostpointercapture', () => {
    drag = null;
    canvas.classList.remove('is-dragging');
  }, options);
  canvas.addEventListener('wheel', event => {
    if (!surface?.faces.length) return;
    event.preventDefault();
    const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? canvas.clientHeight : 1;
    zoom(Math.exp(-clamp(event.deltaY * factor, -150, 150) * 0.002));
  }, { ...options, passive: false });
  canvas.addEventListener('keydown', event => {
    if (!surface?.faces.length) return;
    switch (event.key) {
      case 'ArrowLeft': view.yaw -= 0.11; break;
      case 'ArrowRight': view.yaw += 0.11; break;
      case 'ArrowUp': view.pitch = clamp(view.pitch + 0.09, 0.14, 1.45); break;
      case 'ArrowDown': view.pitch = clamp(view.pitch - 0.09, 0.14, 1.45); break;
      case '+': case '=': zoom(1.15); break;
      case '-': zoom(1 / 1.15); break;
      case '0': reset(); break;
      default: return;
    }
    event.preventDefault();
    invalidate();
  }, options);

  const resize = new ResizeObserver(invalidate);
  resize.observe(canvas);
  return {
    update(data) {
      if (data !== lastData) {
        lastData = data;
        surface = prepareSurface(data);
      }
      const label = data?.title ?? '3D measurement surface';
      canvas.setAttribute('aria-label', surface ? `${label}, ${surface.xLabel} by ${surface.yLabel}, color ${surface.zLabel}` : label);
      resetButton.disabled = !surface?.faces.length;
      range.value = surface
        ? `${surface.count.toLocaleString('en-US')} samples · ${surface.masked.toLocaleString('en-US')} masked${surface.reduced ? ' · Reduced display mesh' : ''}`
        : 'No valid samples';
      invalidate();
    },
    reset,
    disconnect() {
      resize.disconnect();
      events.abort();
      if (frame) cancelAnimationFrame(frame);
      container.replaceChildren();
      plots.delete(container);
    },
  };
}

export function renderSurfacePlot(container, data) {
  if (!plots.has(container)) plots.set(container, createPlot(container));
  const plot = plots.get(container);
  plot.update(data);
  return plot;
}
