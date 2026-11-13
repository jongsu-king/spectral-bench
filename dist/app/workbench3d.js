import { createPart, partAxes, traceScene } from './optics3d.js';
import { BENCH_PRESETS, createBenchPreset } from './presets3d.js';
import { createViewport3D, wavelengthColor } from './viewport3d.js';
import { renderCharts } from './charts.js';

const types = {
  source: ['Light source', 'S'], lens: ['Thin lens', 'L'], mirror: ['Plane mirror', 'M'],
  detector: ['Area detector', 'D'], aperture: ['Aperture', 'A'], splitter: ['Beam splitter', 'BS'],
  filter: ['Bandpass filter', 'F'], grating: ['Diffraction grating', 'G'],
};
const spectra = {
  single: ['Single wavelength', null],
  three: ['Three lines', [450, 532, 635].map(wavelength => ({ wavelength, power: 1 }))],
  visible: ['Visible band (sampled)', [410, 440, 470, 500, 530, 560, 590, 620, 650, 680].map(wavelength => ({ wavelength, power: 1 }))],
  nir: ['Near-infrared lines', [780, 850, 940, 1064].map(wavelength => ({ wavelength, power: 1 }))],
};
const props = {
  source: [
    ['radius', 'Beam radius (mm)', 0.01, 150, 0.5], ['power', 'Power (mW)', 0, 10000, 0.05],
    ['divergence', 'Half-angle (°)', 0, 45, 0.1], ['samples', 'Rays per wavelength', 1, 301, 2],
  ],
  lens: [
    ['radius', 'Clear radius (mm)', 0.1, 150, 1], ['focalLength', 'Focal length (mm)', -2000, 2000, 1],
    ['transmission', 'Transmission', 0, 1, 0.01],
  ],
  mirror: [['radius', 'Radius (mm)', 0.1, 150, 1], ['reflectivity', 'Reflectivity', 0, 1, 0.01]],
  aperture: [['radius', 'Mount radius (mm)', 0.1, 150, 1], ['opening', 'Opening (mm)', 0, 300, 0.5]],
  detector: [
    ['width', 'Sensor width (mm)', 0.1, 300, 0.5], ['height', 'Sensor height (mm)', 0.1, 300, 0.5],
    ['columns', 'Columns', 1, 256, 1], ['rows', 'Rows', 1, 96, 1],
  ],
  splitter: [
    ['radius', 'Radius (mm)', 0.1, 150, 1], ['reflectivity', 'Reflectivity', 0, 1, 0.01],
    ['transmission', 'Transmission', 0, 1, 0.01],
  ],
  filter: [
    ['radius', 'Radius (mm)', 0.1, 150, 1], ['centerWavelength', 'Center (nm)', 180, 1e7, 1],
    ['bandwidth', 'FWHM (nm)', 1, 1e7, 1], ['transmission', 'Peak transmission', 0, 1, 0.01],
  ],
  grating: [
    ['radius', 'Radius (mm)', 0.1, 150, 1], ['grooveDensity', 'Grooves / mm', 10, 3000, 10],
    ['order', 'Diffraction order', -4, 4, 1], ['transmission', 'Order efficiency', 0, 1, 0.01],
  ],
};

const el = id => document.getElementById(id);
const bound = (value, low, high) => Math.min(high, Math.max(low, value));
const copy = value => structuredClone(value);
const fmt = (value, digits = 2) => Number.isFinite(value) ? value.toFixed(digits) : '—';
const powerLabel = value => value > 0 && value < .01 ? fmt(value * 1000, 2) + ' µW' : fmt(value, 3) + ' mW';
const isTextField = element => element instanceof Element && Boolean(element.closest('input,textarea,select,[contenteditable]'));

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function option(value, text) {
  const element = node('option', '', text);
  element.value = value;
  return element;
}

function normalizedScene(input) {
  if (!input || !Array.isArray(input.parts) || input.parts.length > 36) throw new Error('Invalid workbench layout.');
  const seen = new Set();
  const parts = input.parts.map((value, index) => {
    if (!value || !Object.hasOwn(types, value.type)) throw new Error('Unknown optical component.');
    const id = typeof value.id === 'string' && /^[\w-]{1,80}$/.test(value.id) && !seen.has(value.id) ? value.id : 'restored-' + index;
    seen.add(id);
    const part = createPart(value.type, id);
    if (typeof value.name === 'string' && value.name.trim()) part.name = value.name.slice(0, 60);
    part.enabled = value.enabled !== false;
    for (const field of ['position', 'rotation']) {
      if (Array.isArray(value[field]) && value[field].length === 3 && value[field].every(Number.isFinite)) {
        const limit = field === 'position' ? 2500 : 360;
        part[field] = value[field].map(component => bound(component, -limit, limit));
      }
    }
    for (const [key, , min, max] of [...props[value.type], ['wavelength', '', 180, 1e7]]) {
      if (Number.isFinite(value[key])) part[key] = bound(value[key], min, max);
    }
    if (value.type === 'source' && Array.isArray(value.spectrum)) {
      part.spectrum = value.spectrum.slice(0, 24)
        .filter(line => Number.isFinite(line?.wavelength) && line.wavelength > 0 && Number.isFinite(line.power) && line.power > 0)
        .map(({ wavelength, power }) => ({ wavelength, power }));
      if (value.spectralProfile === 'custom') part.spectralProfile = 'custom';
    }
    if (value.type === 'aperture') for (const key of ['openingWidth', 'openingHeight']) {
      if (Number.isFinite(value[key])) part[key] = bound(value[key], 0.01, 300);
    }
    if (value.type === 'grating') part.reflective = value.reflective === true;
    return part;
  });
  return {
    id: typeof input.id === 'string' ? input.id.slice(0, 80) : 'custom',
    name: typeof input.name === 'string' && input.name.trim() ? input.name.slice(0, 60) : 'Custom layout',
    parts,
  };
}

function plotContext(canvas) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  if (!width || !height) return null;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * ratio);
  canvas.height = Math.round(height * ratio);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.font = '10px ui-monospace, monospace';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  return { ctx, width, height };
}

function line(ctx, x1, y1, x2, y2, color, width = 1) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawSpot(canvas, detector, part) {
  const drawing = plotContext(canvas);
  if (!drawing) return null;
  const { ctx, width, height } = drawing;
  if (!detector || !part) {
    ctx.fillStyle = '#565950'; ctx.fillText('No detector', 11, 20); return null;
  }
  const { columns, rows, values } = detector.bins;
  const max = values.reduce((best, value) => Math.max(best, value), 0);
  const scale = Math.min((width - 48) / part.width, (height - 31) / part.height);
  const plotWidth = part.width * scale;
  const plotHeight = part.height * scale;
  const left = (width - plotWidth) / 2;
  const top = (height - 24 - plotHeight) / 2;
  const binWidth = plotWidth / columns;
  const binHeight = plotHeight / rows;
  ctx.fillStyle = '#eef1f4';
  ctx.fillRect(left, top, plotWidth, plotHeight);
  if (max > 0) {
    for (let index = 0; index < values.length; index++) {
      if (!(values[index] > 0)) continue;
      const level = Math.sqrt(values[index] / max);
      ctx.fillStyle = 'rgb(' + [212 - 194 * level, 233 - 135 * level, 224 - 127 * level].map(Math.round).join(',') + ')';
      ctx.fillRect(left + index % columns * binWidth, top + (rows - 1 - Math.floor(index / columns)) * binHeight, binWidth + .3, binHeight + .3);
    }
  }
  ctx.strokeStyle = '#797d72';
  ctx.strokeRect(left, top, plotWidth, plotHeight);
  ctx.setLineDash([2, 2]);
  line(ctx, left + plotWidth / 2, top, left + plotWidth / 2, top + plotHeight, '#6c746c85');
  line(ctx, left, top + plotHeight / 2, left + plotWidth, top + plotHeight / 2, '#6c746c85');
  ctx.setLineDash([]);
  ctx.fillStyle = '#42473e'; ctx.textAlign = 'center';
  ctx.fillText('u (mm)', width / 2, height - 3);
  ctx.fillText(fmt(-part.width / 2, 0), left, height - 15);
  ctx.fillText(fmt(part.width / 2, 0), left + plotWidth, height - 15);
  ctx.textAlign = 'right';
  ctx.fillText(fmt(part.height / 2, 0), left - 4, top + 8);
  ctx.fillText(fmt(-part.height / 2, 0), left - 4, top + plotHeight);
  if (left > 26) {
    ctx.save();
    ctx.translate(12, top + plotHeight / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillText('v (mm)', 0, 0);
    ctx.restore();
  }
  return { left, top, plotWidth, plotHeight, columns, rows, values, width: part.width, height: part.height };
}

function drawSpectrum(canvas, spectrum) {
  const drawing = plotContext(canvas);
  if (!drawing) return;
  const { ctx, width, height } = drawing;
  const data = spectrum ?? [];
  if (!data.length) {
    ctx.fillStyle = '#565950'; ctx.fillText('No spectral samples', 11, 20); return;
  }
  const low = Math.min(...data.map(line => line.wavelength));
  const high = Math.max(...data.map(line => line.wavelength));
  const margin = Math.max(12, (high - low) * .08);
  const left = 60, right = width - 12, top = 9, bottom = height - 29;
  const peak = Math.max(1e-12, ...data.map(line => line.power));
  const mapX = wavelength => left + (wavelength - low + margin) * (right - left) / (high - low + 2 * margin);
  for (let index = 0; index <= 4; index++) {
    const y = bottom - (bottom - top) * index / 4;
    line(ctx, left, y, right, y, '#dddfd4');
  }
  line(ctx, left, top, left, bottom, '#797d72');
  line(ctx, left, bottom, right, bottom, '#797d72');
  ctx.fillStyle = '#42473e'; ctx.textAlign = 'right';
  ctx.fillText(powerLabel(peak), left - 4, top + 8);
  ctx.fillText('0', left - 4, bottom);
  ctx.textAlign = 'center';
  for (const entry of data) {
    const x = mapX(entry.wavelength);
    const y = bottom - (bottom - top) * entry.power / peak;
    if (entry.power > 0) line(ctx, x, bottom, x, y, wavelengthColor(entry.wavelength), 2);
    if (data.length <= 4) ctx.fillText(fmt(entry.wavelength, 0), x, bottom + 12);
  }
  if (data.length > 4) {
    ctx.fillText(fmt(low, 0), mapX(low), bottom + 12);
    ctx.fillText(fmt(high, 0), mapX(high), bottom + 12);
  }
  ctx.fillText('Wavelength (nm)', (left + right) / 2, height - 4);
}

function radiusRms(detector) {
  if (!detector?.centroid || !detector.power) return NaN;
  const [u, v] = detector.centroid;
  return Math.sqrt(detector.hits.reduce((sum, hit) =>
    sum + hit.power * ((hit.u - u) ** 2 + (hit.v - v) ** 2), 0) / detector.power);
}

export function createWorkbench({ exportFile, notify, showCode }) {
  let scene = createBenchPreset('spectrometer');
  let startingLayout = copy(scene);
  let selectedId = scene.parts.find(part => part.type === 'source')?.id ?? null;
  let detectorId;
  let tool = 'move';
  let visible = false;
  let result;
  let redrawFrame = 0;
  let sweepFrame = 0;
  let sweepToken = 0;
  let sweepResult = null;
  let sweepPlot;
  let sensorGeometry;
  let rayIndex = 0;
  let segmentIndex = null;
  let historyGesture = null;
  let currentPanel = 'signal';
  let idCounter = 0;
  const undo = [];
  const redo = [];
  const root = el('workbench');
  const viewport = createViewport3D(el('wb-viewport'), {
    onSelect: id => selectPart(id),
    onMove: (id, value, phase) => applyVector(id, 'position', value, phase),
    onRotate: (id, value, phase) => applyVector(id, 'rotation', value, phase),
    onRaySelect: (index, segment) => {
      rayIndex = index;
      segmentIndex = segment;
      switchPanel('distance');
    },
    onViewChange: view => { el('wb-view').value = view; },
  });

  function partById(id) { return scene.parts.find(part => part.id === id); }
  function currentDetector() { return result?.detectors.find(detector => detector.id === detectorId); }
  function remember(previous) {
    undo.push({ scene: previous, startingLayout: copy(startingLayout) });
    if (undo.length > 50) undo.shift();
    redo.length = 0;
    updateHistory();
  }
  function updateHistory() {
    el('wb-undo').disabled = undo.length === 0;
    el('wb-redo').disabled = redo.length === 0;
  }
  function clearSweep() {
    sweepToken++;
    cancelAnimationFrame(sweepFrame);
    sweepFrame = 0;
    if (sweepResult) el('wb-sweep-state').textContent = 'Layout changed. Run the sweep again.';
    else el('wb-sweep-state').textContent = 'Offsets are along the detector normal.';
    sweepResult = null;
    el('wb-sweep').disabled = false;
    el('wb-sweep-table').hidden = true;
    el('wb-sweep-plot').hidden = true;
    sweepPlot?.disconnect();
  }
  function redraw() {
    if (!visible || redrawFrame) return;
    redrawFrame = requestAnimationFrame(() => {
      redrawFrame = 0;
      result = traceScene(scene);
      updateDetectorList();
      updateViewport();
      renderReadings();
      renderSignal();
      if (currentPanel === 'distance') renderDistance();
    });
  }
  function editPart(id, change, rebuild = false) {
    const part = partById(id);
    if (!part) return;
    const previous = copy(scene);
    change(part);
    if (JSON.stringify(previous) === JSON.stringify(scene)) return;
    remember(previous);
    clearSweep();
    if (rebuild) { renderComponents(); renderInspector(); }
    redraw();
  }
  function applyVector(id, key, value, phase) {
    const part = partById(id);
    if (!part || !Array.isArray(value) || !value.every(Number.isFinite)) return;
    const previous = historyGesture ?? copy(scene);
    if (phase === 'preview' && !historyGesture) historyGesture = previous;
    const nextPart = { ...part, [key]: value.map(component => key === 'position' ? bound(component, -2500, 2500) : ((component + 540) % 360 + 360) % 360 - 180) };
    scene.parts = scene.parts.map(candidate => candidate.id === id ? nextPart : candidate);
    if (phase === 'commit') {
      if (JSON.stringify(previous) !== JSON.stringify(scene)) remember(previous);
      historyGesture = null;
    }
    syncVectors(nextPart);
    clearSweep();
    redraw();
  }
  function replaceLayout(layout, fit = false) {
    scene = normalizedScene(layout);
    if (!partById(selectedId)) selectedId = scene.parts[0]?.id ?? null;
    historyGesture = null;
    renderComponents();
    renderInspector();
    renderPresetSelect();
    clearSweep();
    if (fit) {
      viewport.update({ parts: scene.parts, rays: [], selectedId });
      viewport.resetView();
      el('wb-view').value = 'perspective';
    }
    redraw();
  }
  function selectPart(id) {
    if (!partById(id)) id = null;
    if (id === selectedId) return;
    selectedId = id;
    const part = partById(id);
    if (part?.type === 'detector' && detectorId !== id) {
      detectorId = id;
      clearSweep();
    }
    renderComponents();
    renderInspector();
    redraw();
  }
  function renderPresetSelect() {
    const select = el('wb-preset');
    select.replaceChildren(...BENCH_PRESETS.map(({ id, name }) => option(id, name)), option('empty', 'Empty bench'));
    if (!Array.from(select.options).some(item => item.value === startingLayout.id)) {
      select.append(option(startingLayout.id, startingLayout.name));
    }
    select.value = startingLayout.id;
  }
  function renderComponents() {
    const list = el('wb-component-list');
    el('wb-component-count').value = String(scene.parts.length);
    list.replaceChildren();
    for (const part of scene.parts) {
      const item = node('li');
      const button = node('button', part.enabled ? '' : 'wb-part-inactive');
      button.type = 'button';
      button.dataset.opticId = part.id;
      button.setAttribute('aria-pressed', String(part.id === selectedId));
      button.append(node('span', 'wb-part-symbol', types[part.type][1]), node('span', 'wb-part-name', part.name));
      button.addEventListener('click', () => selectPart(part.id));
      item.append(button);
      list.append(item);
    }
    if (!scene.parts.length) list.append(node('li', 'wb-empty', 'Add a source and detector to begin.'));
    el('wb-add').disabled = scene.parts.length >= 36;
  }

  function numericInput(value, min, max, step, aria, update) {
    const input = node('input');
    input.type = 'number'; input.min = min; input.max = max; input.step = step; input.value = value;
    input.setAttribute('aria-label', aria);
    input.addEventListener('change', () => {
      if (!Number.isFinite(input.valueAsNumber)) { input.value = value; return; }
      const next = bound(input.valueAsNumber, min, max);
      input.value = next;
      update(next);
    });
    return input;
  }
  function propertyRow(label, control) {
    const row = node('label', 'wb-prop-row');
    row.append(node('span', '', label), control);
    return row;
  }
  function check(value, update) {
    const input = node('input');
    input.type = 'checkbox'; input.checked = value;
    input.addEventListener('change', () => update(input.checked));
    return input;
  }
  function vectorFields(part, field, title) {
    const group = node('section', 'wb-prop-group');
    group.append(node('h3', '', title));
    const axes = node('div', 'wb-triplet');
    for (const [index, axis] of ['X', 'Y', 'Z'].entries()) {
      const label = node('label', '', axis);
      const limit = field === 'position' ? 2500 : 360;
      const input = numericInput(Number(part[field][index].toFixed(2)), -limit, limit, 1, title + ' ' + axis, value => {
        editPart(part.id, target => { target[field][index] = value; });
      });
      input.dataset.vector = field + index;
      label.append(input);
      axes.append(label);
    }
    group.append(axes);
    return group;
  }
  function syncVectors(part) {
    if (part.id !== selectedId) return;
    for (const field of ['position', 'rotation']) {
      part[field].forEach((value, index) => {
        const input = root.querySelector('[data-vector="' + field + index + '"]');
        if (input && document.activeElement !== input) input.value = Number(value.toFixed(2));
      });
    }
  }
  function renderInspector() {
    const container = el('wb-properties');
    const part = partById(selectedId);
    container.replaceChildren();
    el('wb-delete').disabled = !part;
    if (!part) {
      container.append(node('p', 'wb-empty', 'Select a component.'));
      return;
    }
    const name = node('input');
    name.type = 'text'; name.value = part.name; name.maxLength = 60;
    name.addEventListener('change', () => {
      const clean = name.value.trim();
      if (!clean) { name.value = part.name; return; }
      editPart(part.id, target => { target.name = clean; }, true);
    });
    container.append(propertyRow('Name', name), propertyRow('Enabled', check(part.enabled, enabled => {
      editPart(part.id, target => { target.enabled = enabled; }, true);
    })));
    container.append(vectorFields(part, 'position', 'Position (mm)'), vectorFields(part, 'rotation', 'Rotation (°)'));
    const optics = node('section', 'wb-prop-group');
    optics.append(node('h3', '', types[part.type][0]));
    if (part.type === 'source') {
      const profile = node('select');
      const serialized = JSON.stringify(part.spectrum?.length ? part.spectrum : null);
      const matching = part.spectralProfile === 'custom' ? 'custom' :
        Object.keys(spectra).find(key => JSON.stringify(spectra[key][1]) === serialized) ?? 'custom';
      profile.append(...Object.entries(spectra).map(([id, [label]]) => option(id, label)), option('custom', 'Custom lines'));
      profile.value = matching;
      profile.addEventListener('change', () => {
        editPart(part.id, target => {
          const selected = profile.value;
          delete target.spectralProfile;
          if (selected === 'single') delete target.spectrum;
          else if (selected === 'custom') {
            target.spectrum = copy(target.spectrum?.length ? target.spectrum : [{ wavelength: target.wavelength, power: 1 }]);
            target.spectralProfile = 'custom';
          }
          else target.spectrum = copy(spectra[selected][1]);
        }, true);
      });
      optics.append(propertyRow('Spectrum', profile));
      if (matching === 'single') {
        optics.append(propertyRow('Wavelength (nm)', numericInput(part.wavelength, 180, 1e7, 1, 'Wavelength in nanometers', value => {
          editPart(part.id, target => { target.wavelength = value; });
        })));
      }
      if (matching === 'custom') {
        const lines = node('input');
        lines.type = 'text'; lines.value = part.spectrum.map(line => line.wavelength + ':' + line.power).join(', ');
        lines.setAttribute('aria-label', 'Wavelength and relative power pairs');
        lines.addEventListener('change', () => {
          const parsed = lines.value.split(',').slice(0, 24).map(entry => entry.trim().split(':').map(Number));
          if (!parsed.length || parsed.some(([wavelength, power = 1]) => wavelength < 180 || wavelength > 1e7 ||
            !Number.isFinite(wavelength) || !Number.isFinite(power) || power <= 0)) {
            notify('Use wavelength:weight pairs, for example 450:1, 532:0.8.');
            return;
          }
          editPart(part.id, target => {
            target.spectrum = parsed.map(([wavelength, power = 1]) => ({ wavelength, power }));
          }, true);
        });
        optics.append(propertyRow('nm : weight', lines));
      }
    }
    for (const [key, label, min, max, step] of props[part.type]) {
      optics.append(propertyRow(label, numericInput(part[key], min, max, step, label, value => {
        editPart(part.id, target => {
          if (key === 'focalLength' && Math.abs(value) < 1) value = value < 0 ? -1 : 1;
          target[key] = value;
        });
      })));
    }
    if (part.type === 'grating') optics.append(propertyRow('Reflective', check(part.reflective, value => {
      editPart(part.id, target => { target.reflective = value; });
    })));
    container.append(optics);
  }

  function updateDetectorList() {
    const detectors = result.detectors;
    if (!detectors.some(detector => detector.id === detectorId)) detectorId = detectors[0]?.id;
    const select = el('wb-detector-select');
    const options = detectors.map(detector => option(detector.id, detector.name));
    select.replaceChildren(...(options.length ? options : [option('', 'No detector')]));
    select.disabled = !detectors.length;
    select.value = detectorId ?? '';
    el('wb-export').disabled = !detectors.length;
  }
  function updateViewport() {
    const selectedRay = currentPanel === 'distance' && result?.rays?.length ? rayIndex : undefined;
    viewport.update({ parts: scene.parts, rays: result?.rays ?? [], selectedId, tool,
      showRays: el('wb-show-rays').checked, showLabels: el('wb-show-labels').checked,
      highlightRay: selectedRay, highlightSegment: segmentIndex });
  }
  function renderReadings() {
    const target = el('wb-readings');
    const detector = currentDetector();
    const rms = radiusRms(detector);
    const coupling = detector && result.emittedPower > 0 ? 100 * detector.power / result.emittedPower : NaN;
    const values = [
      ['Ray paths', String(result.rays.length)], ['Detector power', detector ? powerLabel(detector.power) : '—'],
      ['Captured', Number.isFinite(coupling) ? fmt(coupling, 1) + ' %' : '—'],
      ['Hits', detector ? String(detector.count) : '—'], ['RMS spot', Number.isFinite(rms) ? fmt(rms, 2) + ' mm' : '—'],
    ];
    target.replaceChildren(...values.map(([label, value]) => {
      const pair = node('span', '', label);
      pair.append(node('strong', '', value));
      return pair;
    }));
  }
  function renderSignal() {
    if (!visible || currentPanel !== 'signal') return;
    const detector = currentDetector();
    sensorGeometry = drawSpot(el('wb-spot'), detector, partById(detector?.id));
    drawSpectrum(el('wb-spectrum'), detector?.spectrum);
  }
  function row(values) {
    const element = node('tr');
    element.append(...values.map(value => node('td', '', value)));
    return element;
  }
  function raySegments(ray) {
    if (!ray) return [];
    let cumulative = 0;
    const points = ray.points;
    const interactions = ray.interactions ?? [];
    const sourceName = partById(ray.sourceId)?.name ?? 'Source';
    const sections = [];
    for (let index = 1; index < points.length; index++) {
      const previous = interactions[index - 2];
      const next = interactions[index - 1];
      if (index === points.length - 1 && !next && !ray.detectorId) break;
      const from = index === 1 ? sourceName : partById(previous?.partId)?.name ?? 'Intersection';
      const to = partById(next?.partId)?.name ?? (index === points.length - 1 ? partById(ray.detectorId)?.name ?? 'Ray limit' : 'Intersection');
      const delta = points[index].map((value, axis) => value - points[index - 1][axis]);
      const length = Math.hypot(...delta);
      cumulative += length;
      sections.push({ from, to, length, cumulative, delta });
    }
    return sections;
  }
  function renderDistance() {
    const rays = result?.rays ?? [];
    rayIndex = bound(rayIndex, 0, Math.max(0, rays.length - 1));
    const input = el('wb-ray-index');
    input.max = Math.max(1, rays.length); input.disabled = !rays.length;
    if (document.activeElement !== input) input.value = rayIndex + 1;
    const ray = rays[rayIndex];
    const segments = raySegments(ray);
    el('wb-ray-info').value = ray ? fmt(ray.wavelength, 1) + ' nm · ' + (ray.detectorId ? 'detected' : (ray.reason ?? 'missed')) +
      (segments.length ? ' · ' + fmt(segments.at(-1).cumulative, 2) + ' mm' : '') : 'No rays';
    const table = el('wb-segments');
    table.replaceChildren(...segments.map((segment, index) => {
      const entry = row([segment.from, segment.to, fmt(segment.length, 2), fmt(segment.cumulative, 2),
        segment.delta.map(value => fmt(value, 2)).join(' / ')]);
      entry.classList.toggle('is-selected', index === segmentIndex);
      entry.addEventListener('click', () => { segmentIndex = index; renderDistance(); updateViewport(); });
      return entry;
    }));
    if (!segments.length) table.append(row(['No optical intersection', '—', '—', '—', '—']));
  }

  function sweepSettings() {
    const start = el('wb-sweep-start').valueAsNumber;
    const end = el('wb-sweep-end').valueAsNumber;
    const step = el('wb-sweep-step').valueAsNumber;
    if (![start, end, step].every(Number.isFinite) || start > end || step < .5 || Math.abs(start) > 1500 || Math.abs(end) > 1500 ||
      Math.floor((end - start) / step) + 1 > 121) {
      throw new Error('Use ordered offsets within ±1,500 mm, step ≥ 0.5 mm, and at most 121 positions.');
    }
    return { start, end, step, detectorId };
  }
  function runSweep() {
    const detector = partById(detectorId);
    if (!detector) { el('wb-sweep-state').textContent = 'Add and select a detector first.'; return; }
    let settings;
    try { settings = sweepSettings(); }
    catch (error) { el('wb-sweep-state').textContent = error.message; return; }
    clearSweep();
    const token = ++sweepToken;
    const snapshot = copy(scene);
    const sensor = snapshot.parts.find(part => part.id === detector.id);
    const origin = [...sensor.position];
    const normal = partAxes(sensor).normal;
    const total = Math.floor((settings.end - settings.start) / settings.step + 1e-9) + 1;
    const rows = [];
    el('wb-sweep').disabled = true;
    function next() {
      if (token !== sweepToken) return;
      for (let batch = 0; batch < 4 && rows.length < total; batch++) {
        const offset = settings.start + settings.step * rows.length;
        sensor.position = origin.map((value, index) => value + offset * normal[index]);
        const measurement = traceScene(snapshot).detectors.find(candidate => candidate.id === sensor.id);
        rows.push({ offset, position: [...sensor.position], power: measurement?.power ?? 0,
          count: measurement?.count ?? 0, rms: radiusRms(measurement) });
      }
      el('wb-sweep-state').textContent = 'Tracing ' + rows.length + ' / ' + total + ' detector positions';
      if (rows.length < total) sweepFrame = requestAnimationFrame(next);
      else {
        sweepFrame = 0;
        sweepResult = rows;
        el('wb-sweep').disabled = false;
        renderSweep();
      }
    }
    sweepFrame = requestAnimationFrame(next);
  }
  function renderSweep() {
    if (!sweepResult) return;
    const rows = sweepResult;
    const finite = rows.filter(entry => Number.isFinite(entry.rms));
    const focus = finite.reduce((best, candidate) => !best || candidate.rms < best.rms ? candidate : best, null);
    el('wb-sweep-state').textContent = rows.length + ' positions' + (focus ? ' · minimum RMS radius ' +
      fmt(focus.rms, 2) + ' mm at offset ' + fmt(focus.offset, 1) + ' mm' : ' · no detected rays');
    const output = el('wb-sweep-plot');
    output.hidden = false;
    sweepPlot?.disconnect();
    const x = rows.map(entry => entry.offset);
    sweepPlot = renderCharts(output, [
      { title: 'Power vs. distance', xLabel: 'Detector offset (mm)', yLabel: 'Power (mW)', series: [{ name: 'Power', x, y: rows.map(entry => entry.power), color: '#236f78' }] },
      { title: 'RMS radius vs. distance', xLabel: 'Detector offset (mm)', yLabel: 'RMS radius (mm)', series: [{ name: 'Spot size', x, y: rows.map(entry => entry.rms), color: '#a15d1c' }] },
    ], () => {});
    el('wb-sweep-rows').replaceChildren(...rows.map(entry => row([fmt(entry.offset, 2), fmt(entry.power, 5), entry.count,
      fmt(entry.rms, 3), entry.position.map(value => fmt(value, 2)).join(' / ')])));
    el('wb-sweep-table').hidden = false;
  }
  function csv() {
    const records = [['record', 'label', 'x_mm', 'y_mm', 'z_mm', 'wavelength_nm', 'power_mW', 'ray_count', 'distance_mm', 'rms_mm']];
    const detector = currentDetector();
    for (const hit of detector?.hits ?? []) records.push(['sensor_hit', detector.name, hit.u, hit.v, '', hit.wavelength, hit.power]);
    for (const point of detector?.spectrum ?? []) records.push(['spectrum', detector.name, '', '', '', point.wavelength, point.power]);
    for (const segment of raySegments(result?.rays[rayIndex])) records.push(['ray_segment', segment.from + ' → ' + segment.to,
      ...segment.delta, result.rays[rayIndex].wavelength, '', '', segment.length]);
    for (const entry of sweepResult ?? []) records.push(['sweep', detector?.name, ...entry.position, '', entry.power, entry.count, entry.offset, entry.rms]);
    const serialize = value => value == null || (typeof value === 'number' && !Number.isFinite(value)) ? '' : '"' + String(value).replaceAll('"', '""') + '"';
    return '\uFEFF' + records.map(record => Array.from({ length: 10 }, (_, index) => serialize(record[index])).join(',')).join('\r\n');
  }
  async function matlabCode() {
    const button = el('wb-matlab');
    button.disabled = true;
    try {
      const { generateMatlabWorkbench } = await import('./matlab-export3d.js');
      const settings = detectorId ? sweepSettings() : null;
      const sweepOffsets = settings ? Array.from({ length: Math.floor((settings.end - settings.start) / settings.step + 1e-9) + 1 },
        (_, index) => settings.start + settings.step * index) : [];
      showCode({ title: 'MATLAB ray trace', description: 'Run this script in MATLAB to trace the current layout and repeat the detector sweep.',
        filename: 'spectral_bench_layout.m', code: generateMatlabWorkbench(scene, { sweepDetectorId: detectorId, sweepOffsets }) });
    } catch (error) { notify(error.message || 'MATLAB export failed.'); }
    finally { button.disabled = false; }
  }

  function addPart() {
    if (scene.parts.length >= 36) return;
    const type = el('wb-part-type').value;
    const anchor = partById(selectedId) ?? scene.parts.find(part => part.type === 'source');
    let id;
    do { id = 'optic-' + ++idCounter; } while (partById(id));
    const direction = anchor ? partAxes(anchor).normal : [1, 0, 0];
    const offset = anchor?.type === 'detector' ? -55 : 65;
    const location = anchor ? anchor.position.map((value, index) => value + offset * direction[index]) : [-160, 0, 70];
    const part = createPart(type, id, location);
    if (anchor) part.rotation = [...anchor.rotation];
    if (type === 'mirror') part.rotation[2] -= 45;
    const count = scene.parts.filter(candidate => candidate.type === type).length;
    if (count) part.name += ' ' + (count + 1);
    remember(copy(scene));
    scene.parts.push(part);
    selectedId = part.id;
    if (part.type === 'detector') detectorId = part.id;
    renderComponents();
    renderInspector();
    clearSweep();
    redraw();
  }
  function removePart() {
    const index = scene.parts.findIndex(part => part.id === selectedId);
    if (index < 0) return;
    remember(copy(scene));
    scene.parts.splice(index, 1);
    selectedId = scene.parts[Math.min(index, scene.parts.length - 1)]?.id ?? null;
    renderComponents();
    renderInspector();
    clearSweep();
    redraw();
  }
  function stepHistory(from, to) {
    if (!from.length) return;
    to.push({ scene: copy(scene), startingLayout: copy(startingLayout) });
    const previous = from.pop();
    startingLayout = previous.startingLayout;
    replaceLayout(previous.scene);
    updateHistory();
  }
  function activateLayout(layout) {
    remember(copy(scene));
    startingLayout = copy(layout);
    selectedId = layout.parts.find(part => part.type === 'source')?.id ?? layout.parts[0]?.id ?? null;
    detectorId = undefined;
    rayIndex = 0;
    replaceLayout(layout, true);
  }

  el('wb-part-type').append(...Object.entries(types).map(([key, [label]]) => option(key, label)));
  el('wb-part-type').value = 'lens';
  el('wb-preset').addEventListener('change', () => {
    const id = el('wb-preset').value;
    activateLayout(id === 'empty' ? { id: 'empty', name: 'Empty bench', parts: [] } : createBenchPreset(id));
  });
  el('wb-add').addEventListener('click', addPart);
  el('wb-delete').addEventListener('click', removePart);
  el('wb-reset').addEventListener('click', () => activateLayout(startingLayout));
  el('wb-undo').addEventListener('click', () => stepHistory(undo, redo));
  el('wb-redo').addEventListener('click', () => stepHistory(redo, undo));
  el('wb-view').addEventListener('change', () => viewport.setView(el('wb-view').value));
  el('wb-fit').addEventListener('click', () => { viewport.resetView(); el('wb-view').value = 'perspective'; });
  el('wb-show-rays').addEventListener('change', updateViewport);
  el('wb-show-labels').addEventListener('change', updateViewport);
  for (const button of root.querySelectorAll('[data-wb-tool]')) button.addEventListener('click', () => {
    tool = button.dataset.wbTool;
    for (const candidate of root.querySelectorAll('[data-wb-tool]')) candidate.setAttribute('aria-pressed', String(candidate === button));
    el('wb-gesture').textContent = tool === 'rotate' ? 'Drag to rotate about Z · Shift adjusts Y · Edit all axes in Inspector' :
      'Drag an optic to move it · Drag empty space to orbit';
    updateViewport();
  });
  function switchPanel(panel) {
    currentPanel = panel;
    for (const candidate of root.querySelectorAll('[data-wb-panel]')) candidate.setAttribute('aria-pressed', String(candidate.dataset.wbPanel === panel));
    el('wb-signal').hidden = currentPanel !== 'signal';
    el('wb-distance').hidden = currentPanel !== 'distance';
    renderSignal();
    renderDistance();
    updateViewport();
  }
  for (const button of root.querySelectorAll('[data-wb-panel]')) button.addEventListener('click', () => switchPanel(button.dataset.wbPanel));
  el('wb-detector-select').addEventListener('change', () => {
    detectorId = el('wb-detector-select').value;
    clearSweep(); renderReadings(); renderSignal();
  });
  el('wb-ray-index').addEventListener('change', () => {
    rayIndex = Math.max(0, (el('wb-ray-index').valueAsNumber || 1) - 1) | 0;
    segmentIndex = null;
    el('wb-ray-index').blur();
    renderDistance(); updateViewport();
  });
  el('wb-sweep').addEventListener('click', runSweep);
  for (const id of ['wb-sweep-start', 'wb-sweep-end', 'wb-sweep-step']) el(id).addEventListener('change', clearSweep);
  el('wb-export').addEventListener('click', () => exportFile('spectral-bench-3d.csv', csv()));
  el('wb-matlab').addEventListener('click', matlabCode);
  el('wb-spot').addEventListener('pointermove', event => {
    if (!sensorGeometry) return;
    const geometry = sensorGeometry;
    const rect = el('wb-spot').getBoundingClientRect();
    const u = (event.clientX - rect.left - geometry.left) / geometry.plotWidth;
    const v = 1 - (event.clientY - rect.top - geometry.top) / geometry.plotHeight;
    if (u < 0 || u >= 1 || v < 0 || v >= 1) { el('wb-sensor-cursor').value = ''; return; }
    const pixel = Math.floor(v * geometry.rows) * geometry.columns + Math.floor(u * geometry.columns);
    el('wb-sensor-cursor').value = fmt((u - .5) * geometry.width, 2) + ', ' + fmt((v - .5) * geometry.height, 2) + ' mm · ' + powerLabel(geometry.values[pixel]);
  });
  el('wb-spot').addEventListener('pointerleave', () => { el('wb-sensor-cursor').value = ''; });
  const resizeObserver = new ResizeObserver(renderSignal);
  resizeObserver.observe(el('wb-signal'));
  document.addEventListener('keydown', event => {
    if (!visible || isTextField(event.target) || document.querySelector('dialog[open]')) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) stepHistory(redo, undo); else stepHistory(undo, redo);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault(); removePart();
    }
  });
  renderComponents();
  renderInspector();
  renderPresetSelect();
  updateHistory();

  return {
    show() { visible = true; redraw(); },
    hide() { visible = false; },
    loadLayout(layout) { activateLayout(layout); },
    serialize() { return { scene: copy(scene), startingLayout: copy(startingLayout), selectedId, detectorId }; },
    restore(saved) {
      if (!saved?.scene) return;
      const restored = normalizedScene(saved.scene);
      startingLayout = normalizedScene(saved.startingLayout ?? saved.scene);
      selectedId = saved.selectedId; detectorId = saved.detectorId;
      undo.length = 0; redo.length = 0; updateHistory();
      replaceLayout(restored, true);
    },
  };
}
