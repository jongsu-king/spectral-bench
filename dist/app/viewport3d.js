import { partAxes } from './optics3d.js';

const add = (a, b) => a.map((value, index) => value + b[index]);
const subtract = (a, b) => a.map((value, index) => value - b[index]);
const scale = (a, value) => a.map(item => item * value);
const dot = (a, b) => a.reduce((total, value, index) => total + value * b[index], 0);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const clamp = (value, lower, upper) => Math.min(upper, Math.max(lower, value));
const magnitude = vector => Math.hypot(...vector);
const normalize = vector => scale(vector, 1 / (magnitude(vector) || 1));
const horizontal = [0, 0, 1];
const tau = 2 * Math.PI;
const interfaceFont = '11px system-ui, sans-serif';
const monoFont = '10px "IBM Plex Mono", "SF Mono", Menlo, monospace';
const canvasWell = '#edf0f2';
const activeOutline = '#245d86';
const ultraviolet = '#7440a2';
const infrared = '#a23874';
const terahertz = '#006f79';

const finishes = {
  source: { metal: [142, 138, 123], face: '#9b845a', edge: '#5d4b2d', depth: 24 },
  mirror: { metal: [167, 170, 165], face: '#b3b8b1', edge: '#666c62', depth: 5 },
  lens: { metal: [139, 151, 147], face: '#92aba7', edge: '#536b67', depth: 11 },
  aperture: { metal: [134, 138, 131], face: '#777d74', edge: '#4c514a', depth: 8 },
  detector: { metal: [125, 137, 129], face: '#596a62', edge: '#35473e', depth: 20 },
  splitter: { metal: [139, 151, 151], face: '#9aadb0', edge: '#4d666b', depth: 10 },
  filter: { metal: [142, 140, 152], face: '#a49bae', edge: '#665870', depth: 8 },
  grating: { metal: [148, 150, 145], face: '#a5a9a0', edge: '#555a52', depth: 7 },
};

const visibleSpectrum = [
  [380, [110, 54, 163]], [435, [66, 70, 183]], [470, [19, 97, 177]],
  [495, [0, 111, 131]], [530, [26, 113, 52]], [560, [104, 118, 12]],
  [580, [149, 113, 0]], [610, [178, 71, 14]], [650, [171, 36, 37]], [750, [146, 42, 51]],
];

export function wavelengthColor(wavelength) {
  if (!Number.isFinite(wavelength)) return '#52605a';
  if (wavelength < 380) return ultraviolet;
  if (wavelength >= 30000) return terahertz;
  if (wavelength >= 750) return infrared;
  const upper = visibleSpectrum.findIndex(([edge]) => wavelength < edge);
  const [lowerWavelength, lower] = visibleSpectrum[upper - 1];
  const [upperWavelength, higher] = visibleSpectrum[upper];
  const fraction = (wavelength - lowerWavelength) / (upperWavelength - lowerWavelength);
  return 'rgb(' + lower.map((value, channel) => Math.round(value + (higher[channel] - value) * fraction)).join(',') + ')';
}

function dimensions(part) {
  if (part.type === 'detector' || (part.width > 0 && part.height > 0)) {
    return { width: part.width ?? 48, height: part.height ?? 38, rectangular: true };
  }
  const radius = part.radius ?? 17;
  return { width: radius * 2, height: radius * 2, rectangular: false };
}

function layoutBounds(parts) {
  if (!parts.length) return { minX: -125, maxX: 125, minY: -100, maxY: 100, top: 70 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let top = 0;
  for (const part of parts) {
    const [x, y, z] = part.position;
    const shape = dimensions(part);
    const radius = Math.max(shape.width, shape.height) / 2;
    minX = Math.min(minX, x - radius);
    maxX = Math.max(maxX, x + radius);
    minY = Math.min(minY, y - radius);
    maxY = Math.max(maxY, y + radius);
    top = Math.max(top, z + radius + 12);
  }
  const xMargin = Math.max(36, (230 - (maxX - minX)) / 2);
  const yMargin = Math.max(54, (196 - (maxY - minY)) / 2);
  return { minX: minX - xMargin, maxX: maxX + xMargin, minY: minY - yMargin, maxY: maxY + yMargin, top };
}

function orientation(yaw, pitch) {
  const right = [Math.cos(yaw), Math.sin(yaw), 0];
  const forward = [-Math.sin(yaw) * Math.cos(pitch), Math.cos(yaw) * Math.cos(pitch), -Math.sin(pitch)];
  return { right, forward, up: cross(right, forward) };
}

function worldLoop(center, axisU, axisV, halfWidth, halfHeight, rectangular) {
  if (rectangular) {
    return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([u, v]) =>
      add(center, add(scale(axisU, halfWidth * u), scale(axisV, halfHeight * v))));
  }
  return Array.from({ length: 18 }, (_, index) => {
    const angle = index * tau / 18;
    return add(center, add(scale(axisU, halfWidth * Math.cos(angle)), scale(axisV, halfHeight * Math.sin(angle))));
  });
}

function shade(rgb, factor) {
  return 'rgb(' + rgb.map(channel => Math.round(clamp(channel * factor, 0, 255))).join(',') + ')';
}

function createShape(faces, center, axes, shape, depth, material) {
  const { normal, u, v } = axes;
  const front = worldLoop(add(center, scale(normal, depth / 2)), u, v, shape.width / 2, shape.height / 2, shape.rectangular);
  const back = front.map(point => subtract(point, scale(normal, depth)));
  for (let index = 0; index < front.length; index += 1) {
    const next = (index + 1) % front.length;
    const midpoint = scale(add(front[index], front[next]), 0.5);
    const sideNormal = normalize(subtract(midpoint, add(center, scale(normal, depth / 2))));
    const diffuse = 0.66 + 0.30 * Math.max(0, dot(sideNormal, [-0.4, -0.3, 0.85]));
    faces.push({ points: [front[index], front[next], back[next], back[index]], fill: shade(material.metal, diffuse), edge: '#555b53' });
  }
  faces.push({ points: back, fill: material.face, edge: material.edge, normal: scale(normal, -1) });
  faces.push({ points: front, fill: material.face, edge: material.edge, normal });
  return { front, back };
}

export function createViewport3D(container, callbacks = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'viewport3d-canvas';
  canvas.tabIndex = 0;
  const opticViewLabel = '3D optical bench. Drag the background to orbit. Scroll to zoom. Use the component list to select optics.';
  const rayViewLabel = '3D optical bench. Click a ray to inspect its path. Drag to orbit. Scroll to zoom.';
  canvas.setAttribute('aria-label', opticViewLabel);
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none;outline-offset:-3px';
  container.replaceChildren(canvas);
  const context = canvas.getContext('2d');

  let state = {
    parts: [], rays: [], selectedId: null, tool: 'move', showRays: true,
    showLabels: false, readOnly: false, highlightRay: null, highlightSegment: null,
  };
  let bounds = layoutBounds([]);
  let camera = { yaw: -0.30, pitch: 0.66, target: [0, 0, 24], distance: 410, view: 'perspective' };
  let size = { width: 1, height: 1, ratio: 1 };
  let fitPending = true;
  let frameRequest = 0;
  let hits = [];
  let hoveredId = null;
  let gesture = null;

  function frame() {
    const axes = orientation(camera.yaw, camera.pitch);
    const position = subtract(camera.target, scale(axes.forward, camera.distance));
    const focal = Math.min(size.width * 0.85, size.height * 1.65);
    return { ...axes, position, focal, ortho: camera.view !== 'perspective' };
  }

  function project(point, basis) {
    const relative = subtract(point, basis.position);
    const depth = dot(relative, basis.forward);
    if (!basis.ortho && depth <= 3) return null;
    const factor = basis.focal / (basis.ortho ? camera.distance : depth);
    return {
      x: size.width / 2 + dot(relative, basis.right) * factor,
      y: size.height / 2 - dot(relative, basis.up) * factor,
      depth,
      factor,
    };
  }

  function fit() {
    const { minX, maxX, minY, maxY, top } = bounds;
    camera.target = [(minX + maxX) / 2, (minY + maxY) / 2, top * 0.33];
    const axes = orientation(camera.yaw, camera.pitch);
    const focal = frame().focal;
    let distance = 45;
    for (const x of [minX, maxX]) {
      for (const y of [minY, maxY]) {
        for (const z of [0, top]) {
          const delta = subtract([x, y, z], camera.target);
          const extent = Math.max(
            focal * Math.abs(dot(delta, axes.right)) / Math.max(10, size.width * 0.448),
            focal * Math.abs(dot(delta, axes.up)) / Math.max(10, size.height * 0.405),
          );
          const depthOffset = camera.view === 'perspective' ? -dot(delta, axes.forward) : 0;
          distance = Math.max(distance, extent + depthOffset);
        }
      }
    }
    camera.distance = distance;
  }

  function path2(points, close = false) {
    context.beginPath();
    context.moveTo(points[0].x, points[0].y);
    for (const point of points.slice(1)) context.lineTo(point.x, point.y);
    if (close) context.closePath();
  }

  function strokeWorld(points, basis, color, width = 1) {
    const projected = points.map(point => project(point, basis));
    if (projected.some(point => !point)) return;
    path2(projected);
    context.strokeStyle = color;
    context.lineWidth = width;
    context.stroke();
  }

  function drawFace(points, basis, fill, edge) {
    const projected = points.map(point => project(point, basis));
    if (projected.some(point => !point)) return;
    path2(projected, true);
    if (fill) {
      context.fillStyle = fill;
      context.fill();
    }
    if (edge) {
      context.strokeStyle = edge;
      context.lineWidth = 0.85;
      context.stroke();
    }
  }

  function drawTable(basis) {
    const { minX, maxX, minY, maxY } = bounds;
    const corners = [[minX, minY, 0], [maxX, minY, 0], [maxX, maxY, 0], [minX, maxY, 0]];
    const lower = corners.map(point => subtract(point, [0, 0, 12]));
    for (let index = 0; index < corners.length; index += 1) {
      const next = (index + 1) % corners.length;
      drawFace([corners[index], corners[next], lower[next], lower[index]], basis, '#a2aab0', '#747d84');
    }
    drawFace(corners, basis, '#c9d0d5', '#747d84');

    const span = Math.max(maxX - minX, maxY - minY);
    const rounding = 10 ** Math.floor(Math.log10(span / 32));
    const step = Math.max(25, Math.ceil(span / (32 * rounding)) * rounding);
    for (let x = Math.ceil((minX + 8) / step) * step; x < maxX - 7; x += step) {
      for (let y = Math.ceil((minY + 8) / step) * step; y < maxY - 7; y += step) {
        const screen = project([x, y, 0.1], basis);
        if (!screen || screen.x < 0 || screen.x > size.width || screen.y < 0 || screen.y > size.height) continue;
        const radius = clamp(screen.factor * 1.8, 0.65, 2.8);
        context.beginPath();
        context.ellipse(screen.x, screen.y, radius, radius * Math.max(0.28, Math.sin(camera.pitch)), 0, 0, tau);
        context.fillStyle = '#828c93';
        context.fill();
        context.strokeStyle = '#e0e5e9';
        context.lineWidth = 0.6;
        context.stroke();
      }
    }
  }

  function partFaces(part, faces, decorations) {
    const firstFace = faces.length;
    const axes = partAxes(part);
    const material = finishes[part.type] ?? finishes.aperture;
    const shape = dimensions(part);
    const [x, y, z] = part.position;
    const verticalFrame = { normal: horizontal, u: [1, 0, 0], v: [0, 1, 0] };
    const mountFinish = { metal: [144, 150, 154], face: '#a5adb3', edge: '#657079' };
    createShape(faces, [x, y, 3], verticalFrame, { width: 36, height: 32, rectangular: true }, 5, mountFinish);
    if (z > 9) {
      createShape(faces, [x, y, z * 0.5 + 2], verticalFrame, { width: 8, height: 8 }, z - 2, mountFinish);
    }
    const surfaces = createShape(faces, part.position, axes, shape, material.depth, material);
    if (part.enabled === false) {
      for (let index = firstFace; index < faces.length; index += 1) faces[index].opacity = 0.38;
    }
    decorations.push({ part, axes, shape, material, ...surfaces });
  }

  function drawFaceDetail(decoration, basis) {
    const { part, shape, axes, material, front, back } = decoration;
    const side = dot(subtract(basis.position, part.position), axes.normal) >= 0 ? 1 : -1;
    const outer = side === 1 ? front : back;
    const center = add(part.position, scale(axes.normal, side * (material.depth / 2 + 0.15)));
    const inner = (width, height) => worldLoop(center, axes.u, axes.v, width / 2, height / 2, shape.rectangular);
    if (part.type === 'lens' || part.type === 'mirror' || part.type === 'source' || part.type === 'splitter' || part.type === 'filter') {
      const glass = {
        lens: '#b8d8d0', mirror: '#dce1db', source: '#edc668', splitter: '#b8d6dd', filter: '#ccc0d8',
      };
      drawFace(inner(shape.width * 0.70, shape.height * 0.70), basis, glass[part.type], material.edge);
      const gleam = add(center, add(scale(axes.u, -shape.width * 0.21), scale(axes.v, shape.height * 0.12)));
      strokeWorld([gleam, add(gleam, scale(axes.u, shape.width * 0.40))], basis, '#fffef7', 0.85);
    }
    if (part.type === 'aperture') {
      const opening = part.opening ?? shape.width * 0.36;
      const openWidth = part.openingWidth ?? opening;
      const openHeight = part.openingHeight ?? opening;
      drawFace(inner(Math.min(shape.width, openWidth), Math.min(shape.height, openHeight)), basis, '#d1d4cb', '#51574e');
    }
    if (part.type === 'grating' || part.type === 'detector') {
      const bars = part.type === 'grating' ? 8 : 5;
      for (let index = -bars; index <= bars; index += 1) {
        const centerLine = add(center, scale(axes.u, index * shape.width * 0.37 / bars));
        const edgeOffset = scale(axes.v, shape.height * 0.31);
        const lineColor = part.type === 'grating' ? material.edge : '#c0cfc3';
        strokeWorld([subtract(centerLine, edgeOffset), add(centerLine, edgeOffset)], basis, lineColor, 0.75);
      }
    }
    if (part.id === state.selectedId) drawFace(outer, basis, null, activeOutline);
  }

  function appendRay(points) {
    let penDown = false;
    for (const point of points) {
      if (!point) {
        penDown = false;
        continue;
      }
      if (penDown) context.lineTo(point.x, point.y);
      else context.moveTo(point.x, point.y);
      penDown = true;
    }
  }

  function drawRays(basis) {
    if (!state.showRays) return;
    let inputMax = 0;
    const highlighted = typeof state.highlightRay === 'number' ? state.rays[state.highlightRay] : state.highlightRay;
    const batches = new Map();
    for (const ray of state.rays) inputMax = Math.max(inputMax, ray.inputPower ?? ray.power ?? 0);
    for (const ray of state.rays) {
      if (ray === highlighted) continue;
      const wavelength = Number.isFinite(ray.wavelength) ? Math.round(ray.wavelength / 4) * 4 : undefined;
      const color = ray.color ?? wavelengthColor(wavelength);
      const power = ray.inputPower ?? ray.power ?? inputMax;
      const strength = inputMax > 0 ? Math.sqrt(clamp(power / inputMax, 0, 1)) : 0.8;
      const level = Math.round(strength * 4);
      const key = color + '/' + level;
      let batch = batches.get(key);
      if (!batch) {
        batch = { color, strength: level / 4, paths: [], spots: [] };
        batches.set(key, batch);
      }
      const points = ray.points.map(point => project(point, basis));
      batch.paths.push(points);
      if (ray.detectorId && points.at(-1)) batch.spots.push(points.at(-1));
    }

    const opacity = highlighted ? 0.32 : 1;
    for (const batch of batches.values()) {
      context.beginPath();
      for (const path of batch.paths) appendRay(path);
      context.strokeStyle = '#fffef7';
      context.globalAlpha = opacity * (0.08 + batch.strength * 0.16);
      context.lineWidth = 2.5;
      context.stroke();
      context.strokeStyle = batch.color;
      context.globalAlpha = opacity * (0.24 + batch.strength * 0.59);
      context.lineWidth = 1.15;
      context.stroke();
      context.beginPath();
      for (const spot of batch.spots) {
        context.moveTo(spot.x + 1.55, spot.y);
        context.arc(spot.x, spot.y, 1.55, 0, tau);
      }
      context.fillStyle = batch.color;
      context.fill();
    }
    context.globalAlpha = 1;

    if (highlighted) {
      const points = highlighted.points.map(point => project(point, basis));
      const color = highlighted.color ?? wavelengthColor(highlighted.wavelength);
      context.beginPath();
      appendRay(points);
      context.strokeStyle = color;
      context.lineWidth = 2.5;
      context.stroke();
      const segment = state.highlightSegment;
      if (Number.isInteger(segment) && points[segment] && points[segment + 1]) {
        const start = points[segment];
        const end = points[segment + 1];
        path2([start, end]);
        context.strokeStyle = '#242621';
        context.lineWidth = 3.5;
        context.stroke();
        context.strokeStyle = '#fffef7';
        context.lineWidth = 1.5;
        context.stroke();
        const length = magnitude(subtract(highlighted.points[segment + 1], highlighted.points[segment]));
        const label = length.toFixed(1) + ' mm';
        context.font = monoFont;
        const labelWidth = context.measureText(label).width + 10;
        const left = clamp((start.x + end.x - labelWidth) / 2, 6, size.width - labelWidth - 6);
        const top = clamp((start.y + end.y) / 2 + 8, 6, size.height - 22);
        context.fillStyle = '#fffef7';
        context.fillRect(left, top, labelWidth, 16);
        context.lineWidth = 1;
        context.strokeStyle = '#94998d';
        context.strokeRect(left, top, labelWidth, 16);
        context.fillStyle = '#242621';
        context.fillText(label, left + 5, top + 11);
      }
      context.fillStyle = color;
      for (const point of points) {
        if (!point) continue;
        context.beginPath();
        context.arc(point.x, point.y, 2.7, 0, tau);
        context.fill();
      }
    }
  }

  function drawParts(basis) {
    const faces = [];
    const decorations = [];
    for (const part of state.parts) partFaces(part, faces, decorations);
    const faceDepth = points => points.reduce((sum, point) => sum + dot(subtract(point, basis.position), basis.forward), 0) / points.length;
    const queue = faces.map(face => ({ ...face, depth: faceDepth(face.points) }));
    for (const decoration of decorations) {
      const positiveSide = dot(subtract(basis.position, decoration.part.position), decoration.axes.normal) >= 0;
      queue.push({ decoration, depth: faceDepth(positiveSide ? decoration.front : decoration.back) - 0.24 });
    }
    queue.sort((left, right) => right.depth - left.depth);
    for (const face of queue) {
      if (face.decoration) {
        context.globalAlpha = face.decoration.part.enabled === false ? 0.38 : 1;
        drawFaceDetail(face.decoration, basis);
      } else {
        if (face.normal && dot(subtract(basis.position, face.points[0]), face.normal) <= 0) continue;
        context.globalAlpha = face.opacity ?? 1;
        drawFace(face.points, basis, face.fill, face.edge);
      }
    }
    context.globalAlpha = 1;
  }

  function drawPartGuides(basis) {
    hits = [];
    const ordered = [...state.parts].sort((a, b) => Number(b.id === state.selectedId) - Number(a.id === state.selectedId));
    for (const part of ordered) {
      const center = project(part.position, basis);
      if (!center) continue;
      const shape = dimensions(part);
      const selected = part.id === state.selectedId;
      const radius = clamp(Math.max(shape.width, shape.height) * center.factor / 2 + 5, 10, 54);
      if (center.x + radius < 0 || center.x - radius > size.width || center.y + radius < 0 || center.y - radius > size.height) continue;
      hits.push({ part, center, radius });
      if (selected) {
        const mount = [part.position[0], part.position[1], 0.6];
        const ring = worldLoop(mount, [1, 0, 0], [0, 1, 0], 23, 23, false);
        strokeWorld([...ring, ring[0]], basis, activeOutline, 1.2);
        if (!state.readOnly && state.tool === 'rotate') {
          const orbit = worldLoop(part.position, [1, 0, 0], [0, 1, 0], 29, 29, false);
          strokeWorld([...orbit, orbit[0]], basis, activeOutline, 1.45);
        }
      }
    }

    const labels = [];
    const priority = part => part.id === state.selectedId ? 2 : Number(part.id === hoveredId);
    const labelParts = hits.map(hit => hit.part).filter(part => part.name && (state.showLabels || priority(part)));
    labelParts.sort((left, right) => priority(right) - priority(left));
    context.font = interfaceFont;
    for (const part of labelParts) {
      const selected = part.id === state.selectedId;
      const caption = project(add(part.position, [0, 0, dimensions(part).height / 2 + 10]), basis);
      if (!caption) continue;
      const width = Math.min(context.measureText(part.name).width + 8, size.width - 12);
      if (width < 20) continue;
      const left = clamp(caption.x - width / 2, 6, size.width - width - 6);
      const preferredTop = clamp(caption.y - 14, 23, size.height - 24);
      const candidates = [preferredTop, preferredTop - 19, preferredTop + 19, preferredTop - 38];
      const top = candidates.find(y => y >= 23 && y <= size.height - 24 && !labels.some(label =>
        left - 2 < label.left + label.width && left + width + 2 > label.left && Math.abs(y - label.top) < 19));
      if (top === undefined) continue;
      labels.push({ left, top, width });
      if (top !== preferredTop) {
        const y = clamp(caption.y, top, top + 17);
        path2([{ x: caption.x, y: caption.y }, { x: clamp(caption.x, left, left + width), y }]);
        context.lineWidth = 0.7;
        context.strokeStyle = '#7b8076';
        context.stroke();
      }
      context.fillStyle = selected ? '#e7f0f7' : '#fffffff0';
      context.fillRect(left, top, width, 17);
      context.strokeStyle = selected ? activeOutline : '#a0a9b1';
      context.lineWidth = 0.75;
      context.strokeRect(left, top, width, 17);
      context.fillStyle = '#242b31';
      context.fillText(part.name, left + 4, top + 12, width - 8);
    }
  }

  function drawAxes(basis) {
    const origin = { x: 34, y: size.height - 30 };
    const axes = [
      { vector: [1, 0, 0], color: '#a0312b', label: 'X' },
      { vector: [0, 1, 0], color: '#336846', label: 'Y' },
      { vector: [0, 0, 1], color: '#285784', label: 'Z' },
    ];
    context.font = monoFont;
    for (const axis of axes) {
      const horizontalDistance = dot(axis.vector, basis.right);
      const verticalDistance = dot(axis.vector, basis.up);
      if (Math.hypot(horizontalDistance, verticalDistance) < 0.14) continue;
      const tip = { x: origin.x + 20 * horizontalDistance, y: origin.y - 20 * verticalDistance };
      path2([origin, tip]);
      context.strokeStyle = axis.color;
      context.lineWidth = 1.5;
      context.stroke();
      context.fillStyle = axis.color;
      context.fillText(axis.label, tip.x + 5 * horizontalDistance - 3, tip.y - 6 * verticalDistance + 3);
    }
  }

  function drawScale(basis) {
    const center = [(bounds.minX + bounds.maxX) / 2, (bounds.minY + bounds.maxY) / 2, 0];
    const factor = project(center, basis)?.factor;
    if (!factor || size.width < 220) return;
    const limit = 85 / factor;
    const decade = 10 ** Math.floor(Math.log10(limit));
    const length = ([5, 2, 1].find(step => step * decade <= limit) ?? 1) * decade;
    const right = size.width - 17;
    const left = right - length * factor;
    const y = size.height - 15;
    context.beginPath();
    context.moveTo(left, y - 3);
    context.lineTo(left, y);
    context.lineTo(right, y);
    context.lineTo(right, y - 3);
    context.lineWidth = 1;
    context.strokeStyle = '#4f544b';
    context.stroke();
    context.font = monoFont;
    context.fillStyle = '#4f544b';
    context.textAlign = 'center';
    context.fillText(Number(length.toPrecision(3)) + ' mm', (left + right) / 2, y - 6);
    context.textAlign = 'start';
  }

  function drawRayKey() {
    if (!state.showRays || size.width < 235) return;
    const bands = [
      { label: 'UV', color: ultraviolet, test: value => value < 380 },
      { label: 'IR', color: infrared, test: value => value >= 750 && value < 30000 },
      { label: 'THz', color: terahertz, test: value => value >= 30000 },
    ].filter(band => state.rays.some(ray => band.test(ray.wavelength)));
    if (!bands.length) return;
    context.font = monoFont;
    let x = 12;
    for (const { label, color } of bands) {
      context.fillStyle = color;
      context.fillRect(x, 13, 10, 2);
      context.fillStyle = '#4f544b';
      context.fillText(label, x + 14, 17);
      x += 24 + context.measureText(label).width;
    }
    context.fillText('false color', x, 17);
  }

  function draw() {
    frameRequest = 0;
    const rect = container.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (width <= 0 || height <= 0) {
      hoveredId = null;
      return;
    }
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const resized = width !== size.width || height !== size.height || ratio !== size.ratio;
    if (resized) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      size = { width, height, ratio };
    }
    if (fitPending || resized) {
      fit();
      fitPending = false;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.fillStyle = canvasWell;
    context.fillRect(0, 0, width, height);
    const basis = frame();
    drawTable(basis);
    drawParts(basis);
    drawRays(basis);
    drawPartGuides(basis);
    drawAxes(basis);
    drawScale(basis);
    drawRayKey();
  }

  function invalidate() {
    if (!frameRequest) frameRequest = window.requestAnimationFrame(draw);
  }

  function pointerPosition(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function pointOnPlane(screen, part, basis, view) {
    const horizontalDistance = (screen.x - size.width / 2) / basis.focal;
    const verticalDistance = (size.height / 2 - screen.y) / basis.focal;
    const screenVector = add(scale(basis.right, horizontalDistance), scale(basis.up, verticalDistance));
    const direction = basis.ortho ? basis.forward : add(basis.forward, screenVector);
    const position = basis.ortho ? add(basis.position, scale(screenVector, camera.distance)) : basis.position;
    const axis = view === 'front' ? 1 : view === 'side' ? 0 : 2;
    if (Math.abs(direction[axis]) < 1e-6) return null;
    const distance = (part.position[axis] - position[axis]) / direction[axis];
    return add(position, scale(direction, distance));
  }

  function pickedPart(screen) {
    const inside = hits.filter(({ center, radius }) => Math.hypot(center.x - screen.x, center.y - screen.y) <= radius);
    inside.sort((a, b) => {
      const delta = Math.hypot(a.center.x - screen.x, a.center.y - screen.y) - Math.hypot(b.center.x - screen.x, b.center.y - screen.y);
      return Math.abs(delta) < 3 ? a.center.depth - b.center.depth : delta;
    });
    return inside[0]?.part;
  }

  function pickedRay(screen, basis) {
    if (!callbacks.onRaySelect || !state.showRays) return null;
    let nearest = null;
    let bestDistance = 6;
    for (let index = 0; index < state.rays.length; index += 1) {
      const points = state.rays[index].points.map(point => project(point, basis));
      for (let segment = 0; segment < points.length - 1; segment += 1) {
        const a = points[segment];
        const b = points[segment + 1];
        if (!a || !b) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lengthSquared = dx * dx + dy * dy;
        const t = lengthSquared ? clamp(((screen.x - a.x) * dx + (screen.y - a.y) * dy) / lengthSquared, 0, 1) : 0;
        const distance = Math.hypot(screen.x - a.x - t * dx, screen.y - a.y - t * dy);
        if (distance < bestDistance) {
          nearest = { index, segment };
          bestDistance = distance;
        }
      }
    }
    return nearest;
  }

  function pointerDown(event) {
    if (gesture || event.button > 2) return;
    const screen = pointerPosition(event);
    const picked = event.button === 0 && state.tool !== 'ray' ? pickedPart(screen) : null;
    const part = picked ? { ...picked, position: [...picked.position], rotation: [...(picked.rotation ?? [0, 0, 0])] } : null;
    const editable = part && !state.readOnly && (state.tool === 'move' || state.tool === 'rotate');
    const mode = editable ? state.tool : event.button !== 0 || (event.shiftKey && !part) ? 'pan' : 'orbit';
    const basis = frame();
    const vertical = mode === 'move' && event.altKey;
    const ray = !part && event.button === 0 ? pickedRay(screen, basis) : null;
    clearHover();
    if (part) callbacks.onSelect?.(part.id);
    gesture = {
      mode, part, start: screen, pointer: event.pointerId, basis, camera: { ...camera },
      startOnPlane: editable && mode === 'move' && !vertical ? pointOnPlane(screen, part, basis, camera.view) : null,
      lastValue: null, moved: false, vertical, ray,
    };
    canvas.focus({ preventScroll: true });
    try { canvas.setPointerCapture(event.pointerId); } catch { /* Synthetic pointer events may have no active capture. */ }
    window.addEventListener('pointermove', pointerMove, true);
    window.addEventListener('pointerup', finishGesture, true);
    window.addEventListener('pointercancel', pointerCancel, true);
    window.addEventListener('blur', cancelOnBlur);
    event.preventDefault();
  }

  function pointerMove(event) {
    if (!gesture) {
      const part = pickedPart(pointerPosition(event));
      if (state.tool === 'ray') {
        canvas.style.cursor = state.showRays ? 'crosshair' : 'grab';
      } else {
        canvas.style.cursor = part
          ? (state.readOnly || state.tool === 'orbit' ? 'pointer' : state.tool === 'move' ? 'move' : 'crosshair')
          : 'grab';
      }
      const nextHoveredId = part?.id ?? null;
      if (hoveredId !== nextHoveredId) {
        hoveredId = nextHoveredId;
        invalidate();
      }
      return;
    }
    if (gesture?.pointer !== event.pointerId) return;
    const screen = pointerPosition(event);
    const dx = screen.x - gesture.start.x;
    const dy = screen.y - gesture.start.y;
    if (!gesture.moved && Math.hypot(dx, dy) < 3) return;
    gesture.moved = true;
    const { mode, part, basis } = gesture;
    if (mode === 'move') {
      const point = gesture.startOnPlane && pointOnPlane(screen, part, basis, gesture.camera.view);
      const displacement = gesture.vertical
        ? [0, 0, -dy * gesture.camera.distance / basis.focal]
        : point && subtract(point, gesture.startOnPlane);
      if (displacement) {
        const result = add(part.position, displacement);
        result[2] = Math.max(0, result[2]);
        gesture.lastValue = result;
        callbacks.onMove?.(part.id, result, 'preview');
      }
    } else if (mode === 'rotate') {
      const result = [...(part.rotation ?? [0, 0, 0])];
      const axis = event.altKey ? 0 : event.shiftKey ? 1 : 2;
      result[axis] += (dx - dy * 0.30) * 0.55;
      gesture.lastValue = result;
      callbacks.onRotate?.(part.id, result, 'preview');
    } else if (mode === 'pan') {
      const factor = gesture.camera.distance / basis.focal;
      camera.target = add(gesture.camera.target, add(scale(basis.right, -dx * factor), scale(basis.up, dy * factor)));
    } else {
      if (camera.view !== 'perspective') callbacks.onViewChange?.('perspective');
      camera.view = 'perspective';
      camera.yaw = gesture.camera.yaw - dx * 0.008;
      camera.pitch = clamp(gesture.camera.pitch + dy * 0.007, 0.10, 1.49);
    }
    invalidate();
  }

  function finishGesture(event, cancel = false) {
    if (!gesture || (event && gesture.pointer !== event.pointerId)) return;
    const { part, mode, lastValue, ray, moved } = gesture;
    gesture = null;
    window.removeEventListener('pointermove', pointerMove, true);
    window.removeEventListener('pointerup', finishGesture, true);
    window.removeEventListener('pointercancel', pointerCancel, true);
    window.removeEventListener('blur', cancelOnBlur);
    if (lastValue && mode === 'move') callbacks.onMove?.(part.id, cancel ? part.position : lastValue, 'commit');
    if (lastValue && mode === 'rotate') callbacks.onRotate?.(part.id, cancel ? part.rotation ?? [0, 0, 0] : lastValue, 'commit');
    if (!moved && !cancel && ray) callbacks.onRaySelect?.(ray.index, ray.segment);
    invalidate();
  }

  function keyboard(event) {
    if (event.key === 'Escape' && gesture) {
      finishGesture(null, true);
      event.preventDefault();
      return;
    }
    if (event.key.toLowerCase() === 'f') {
      fitPending = true;
      invalidate();
      event.preventDefault();
      return;
    }
    const step = event.shiftKey ? 10 : 1;
    const deltas = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const delta = deltas[event.key];
    if (!delta) return;
    const part = state.parts.find(item => item.id === state.selectedId);
    if (part && !state.readOnly && state.tool === 'move') {
      const movement = event.altKey ? [delta[0], 0, delta[1]] : [...delta, 0];
      const position = add(part.position, movement);
      position[2] = Math.max(0, position[2]);
      callbacks.onMove?.(part.id, position, 'commit');
    } else if (part && !state.readOnly && state.tool === 'rotate') {
      const rotation = [...(part.rotation ?? [0, 0, 0])];
      rotation[event.altKey ? 0 : 2] += delta[0];
      rotation[event.altKey ? 0 : 1] += delta[1];
      callbacks.onRotate?.(part.id, rotation, 'commit');
    } else {
      if (camera.view !== 'perspective') callbacks.onViewChange?.('perspective');
      camera.view = 'perspective';
      camera.yaw -= delta[0] * 0.025;
      camera.pitch = clamp(camera.pitch + delta[1] * 0.025, 0.10, 1.49);
      invalidate();
    }
    event.preventDefault();
  }

  function zoom(event) {
    const span = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 120);
    camera.distance = clamp(camera.distance * Math.exp(event.deltaY * 0.0017), span * 0.20, span * 12);
    invalidate();
    event.preventDefault();
  }

  function preventContextMenu(event) { event.preventDefault(); }
  function pointerCancel(event) { finishGesture(event, true); }
  function cancelOnBlur() { finishGesture(null, true); }
  function clearHover() {
    if (hoveredId === null) return;
    hoveredId = null;
    invalidate();
  }

  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', event => { if (!gesture) pointerMove(event); });
  canvas.addEventListener('pointerleave', clearHover);
  canvas.addEventListener('wheel', zoom, { passive: false });
  canvas.addEventListener('contextmenu', preventContextMenu);
  canvas.addEventListener('keydown', keyboard);
  const resizeObserver = new ResizeObserver(invalidate);
  resizeObserver.observe(container);

  function setView(view) {
    const angles = { perspective: [-0.30, 0.66], top: [0, Math.PI / 2], front: [0, 0], side: [Math.PI / 2, 0] };
    if (!Object.hasOwn(angles, view)) return;
    hoveredId = null;
    [camera.yaw, camera.pitch] = angles[view];
    camera.view = view;
    callbacks.onViewChange?.(view);
    fitPending = true;
    invalidate();
  }

  return {
    update(next) {
      const wasInspectingRay = state.tool === 'ray';
      state = { ...state, ...next };
      bounds = layoutBounds(state.parts);
      const inspectingRay = state.tool === 'ray';
      if (inspectingRay !== wasInspectingRay) canvas.setAttribute('aria-label', inspectingRay ? rayViewLabel : opticViewLabel);
      canvas.style.cursor = state.readOnly || state.tool === 'orbit' || (inspectingRay && !state.showRays) ? 'grab' : 'crosshair';
      invalidate();
    },
    setView,
    resetView() {
      setView('perspective');
    },
    destroy() {
      finishGesture(null, true);
      if (frameRequest) window.cancelAnimationFrame(frameRequest);
      resizeObserver.disconnect();
      canvas.remove();
    },
  };
}
