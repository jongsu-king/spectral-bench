import { traceBench } from './bench.js';
import { ARRAY_OPTICS, arrayInputLines } from './models-optical.js';
import { createPart } from './optics3d.js';

const beamHeight = 72;
const toDegrees = 180 / Math.PI;
const nominalColors = {
  '#b7a0ff': 405, '#80b6ff': 450, '#67eee2': 500,
  '#d7ff61': 532, '#ffab7a': 590, '#ff87af': 630, '#fff4d8': 550,
};
const arraySpectrum = [
  { wavelength: 450, power: 0.69 }, { wavelength: 520, power: 1 }, { wavelength: 630, power: 0.76 },
];
export const BENCH_PRESETS = [
  { id: 'collimation', name: 'Collimation and focus' },
  { id: 'folded', name: 'Folded beam' },
  { id: 'spectrometer', name: 'Grating spectrometer' },
];

function optic(type, id, name, x, y, yaw = 0, settings = {}) {
  const part = { ...createPart(type, id, [x, y, beamHeight]), name, rotation: [0, 0, yaw], ...settings };
  if (part.spectrum) part.spectrum = part.spectrum.map((entry) => ({ ...entry }));
  return part;
}

function displacedPoint([x, y], angle, distance) {
  return [x + distance * Math.cos(angle), y + distance * Math.sin(angle)];
}

function collimation() {
  return [
    optic('source', 'source', '532 nm source', -330, -18, 0, { wavelength: 532, radius: 0.5, divergence: 5, samples: 49, power: 1 }),
    optic('lens', 'collimator', 'Collimating lens', -230, -18, 0, { radius: 25, focalLength: 100 }),
    optic('aperture', 'stop', 'Iris', -65, -18, 0, { radius: 25, opening: 18 }),
    optic('lens', 'focus', 'Focusing lens', 90, -18, 0, { radius: 25, focalLength: 140 }),
    optic('detector', 'detector', 'Beam profiler', 230, -18, 0, { width: 38, height: 38, columns: 24, rows: 24 }),
  ];
}

function folded() {
  return [
    optic('source', 'source', '635 nm source', -320, -112, 0, { wavelength: 635, radius: 3, divergence: 0.35, samples: 37, power: 1 }),
    optic('mirror', 'fold-1', 'First steering mirror', -76, -112, -45, { radius: 25 }),
    optic('mirror', 'fold-2', 'Second steering mirror', -76, 116, -45, { radius: 25 }),
    optic('lens', 'focus', 'Focusing lens', 110, 116, 0, { radius: 23, focalLength: 130 }),
    optic('detector', 'detector', 'Beam profiler', 240, 116, 0, { width: 42, height: 42, columns: 24, rows: 24 }),
  ];
}

function spectrometer() {
  const grating = [-10, -94];
  const focusDistance = 155;
  const grooveDensity = 600;
  const angle = Math.asin(520 * grooveDensity / 1e6);
  const lens = displacedPoint(grating, angle, 155);
  const detector = displacedPoint(lens, angle, focusDistance);
  return [
    optic('source', 'fiber', 'Fiber source', -330, -94, 0, { spectrum: arraySpectrum, radius: 0.12, divergence: 0.25, samples: 61, power: 1 }),
    optic('aperture', 'slit', 'Entrance slit', -310, -94, 0, { radius: 20, opening: 40, openingWidth: 0.75, openingHeight: 8 }),
    optic('lens', 'collimator', 'Collimating lens', -160, -94, 0, { radius: 27, focalLength: 150 }),
    optic('grating', 'grating', 'Transmission grating', ...grating, 0, { radius: 28, grooveDensity, order: 1, reflective: false }),
    optic('lens', 'focus', 'Camera lens', ...lens, angle * toDegrees, { radius: 38, focalLength: focusDistance }),
    optic('detector', 'detector', 'Linear CCD', ...detector, angle * toDegrees, { width: 48, height: 12, columns: 128, rows: 1 }),
  ];
}

const makePreset = { collimation, folded, spectrometer };

export function createBenchPreset(id = 'collimation') {
  const preset = BENCH_PRESETS.find((entry) => entry.id === id) ?? BENCH_PRESETS[0];
  return { ...preset, parts: makePreset[preset.id]() };
}

function tablePoint([x, y]) {
  return [x - 430, y - 165, beamHeight];
}

function subtract([x, y], [u, v]) {
  return [x - u, y - v];
}

function direction(vector) {
  const length = Math.hypot(...vector) || 1;
  return vector.map((component) => component / length);
}

function yaw([x, y]) {
  return Math.atan2(y, x) * toDegrees;
}

function layoutDirections(trace) {
  const points = new Map(trace.parts.map(({ id, point }) => [id, point]));
  const axes = new Map();
  const branches = new Map();
  const routes = [...trace.routes].sort((a, b) => Number(Boolean(b.main)) - Number(Boolean(a.main)));
  for (const route of routes) {
    route.ids.forEach((id, index) => {
      const point = points.get(id);
      const previous = points.get(route.ids[index - 1]);
      const next = points.get(route.ids[index + 1]);
      if (!point) return;
      const incoming = previous && direction(subtract(point, previous));
      const outgoing = next && direction(subtract(next, point));
      if (!index && outgoing && !branches.has(id)) branches.set(id, outgoing);
      if (!axes.has(id) || (incoming && !axes.get(id).incoming)) axes.set(id, { incoming, outgoing });
    });
  }
  return { axes, branches };
}

const displayTypes = {
  source: 'source', slit: 'aperture', mirror: 'mirror', lens: 'lens', grating: 'grating', sample: 'aperture',
  detector: 'detector', filter: 'filter', splitter: 'splitter', delay: 'aperture', sphere: 'aperture',
  polarizer: 'filter', antenna: 'detector', electronics: 'detector', atr: 'aperture',
};

function displayPart(part, directions) {
  const { incoming, outgoing } = directions.axes.get(part.id) ?? {};
  const type = displayTypes[part.kind] ?? 'aperture';
  const turning = incoming && outgoing && Math.hypot(...subtract(incoming, outgoing)) > 0.03;
  const normal = turning ? subtract(incoming, outgoing) : (incoming ?? outgoing);
  const angle = normal ? yaw(normal) : (part.angle ?? 0);
  const data = createPart(type, part.id, tablePoint(part.point));
  return {
    ...data, name: part.label || data.name, rotation: [0, 0, angle], enabled: part.disabled !== true,
    ...(part.linear ? { width: 62, height: 16 } : {}),
  };
}

// Instrument-specific paths and signals are calculated by the existing instrument
// models. Lifting their paths for display does not require a second optical solve.
export function instrumentBenchView(trace, nominalTrace = trace) {
  const orientations = layoutDirections(nominalTrace);
  const parts = trace.parts.map((part) => displayPart(part, orientations));
  const detectors = trace.parts.filter(({ kind }) => kind === 'detector' || kind === 'antenna');
  const rays = trace.rays.map((ray) => {
    const endpoint = ray.points.at(-1);
    const detector = ray.detectorHit && endpoint && detectors.find(({ point }) => Math.hypot(...subtract(point, endpoint)) < 40);
    return {
      points: ray.points.map(tablePoint),
      wavelength: ray.wavelength ?? nominalColors[ray.color] ?? 550,
      color: ray.color,
      power: Math.max(0, ray.alpha ?? ray.throughput ?? 1),
      detectorId: detector?.id ?? null,
    };
  });
  return { parts, rays };
}

function editableArray(trace, settings) {
  const axes = {
    fiber: -ARRAY_OPTICS.nominalIncidence * toDegrees,
    slit: -ARRAY_OPTICS.nominalIncidence * toDegrees,
    collimator: -ARRAY_OPTICS.nominalIncidence * toDegrees,
    grating: -(settings.rotation ?? 0),
    focus: ARRAY_OPTICS.nominalBeta * toDegrees,
    detector: ARRAY_OPTICS.nominalBeta * toDegrees,
  };
  const spectrum = arrayInputLines(settings)?.map(([wavelength, power]) => ({ wavelength, power })) ?? arraySpectrum;
  const overrides = {
    fiber: { radius: 0.018, divergence: 0.025, spectrum, samples: 25, power: 1 },
    slit: { radius: 23, opening: 46, openingWidth: (settings.slit ?? 70) * 0.00295, openingHeight: 4 },
    collimator: { radius: 30, focalLength: 117 },
    grating: { radius: 27, grooveDensity: settings.density ?? 600, order: 1, reflective: false },
    focus: { radius: 57, focalLength: 180.54 },
    detector: { width: 64.7, height: 12, columns: 128, rows: 1 },
  };
  return trace.parts.map(({ id, kind, point, label }) => {
    const [x, y] = tablePoint(point);
    return optic(displayTypes[kind], id, label, x, y, axes[id], overrides[id]);
  });
}

function editableRaman(settings) {
  const wavelength = Number(settings.laser) || 532;
  const emitted = 1e7 / (1e7 / wavelength - 520.7);
  const angle = Math.asin(emitted * 600 / 1e6);
  const grating = [14, 90];
  const detector = displacedPoint(grating, angle, 210);
  return [
    optic('source', 'laser', 'Excitation laser', -315, -65, 0, { wavelength, radius: 1, divergence: 0.2, samples: 19 }),
    optic('splitter', 'splitter', 'Dichroic splitter', -110, -65, 45, { radius: 25, reflectivity: 0.55, transmission: 0.45 }),
    optic('lens', 'objective', 'Objective', -110, -145, -90, { radius: 24, focalLength: 70 }),
    optic('aperture', 'sample', 'Sample position', -110, -214, -90, { radius: 22, opening: 44 }),
    optic('source', 'scattering', 'Raman scattering source', -110, -215, 90, { wavelength: emitted, radius: 0.5, divergence: 3, samples: 19, power: 0.02 }),
    optic('filter', 'filter', 'Rayleigh rejection filter', -110, 18, 90, { radius: 25, centerWavelength: emitted, bandwidth: 70, enabled: settings.filter !== false }),
    optic('mirror', 'relay', 'Collection mirror', -110, 90, -45, { radius: 30 }),
    optic('grating', 'grating', 'Transmission grating', ...grating, 0, { radius: 30, grooveDensity: 600, order: 1, reflective: false }),
    optic('detector', 'detector', 'Linear CCD', ...detector, angle * toDegrees, { width: 45, height: 14, columns: 128, rows: 1 }),
  ];
}

function editableReflectance() {
  return [
    optic('source', 'lamp', 'Broadband lamp', -315, -54, 0, { spectrum: arraySpectrum, radius: 2, divergence: 0.4, samples: 25 }),
    optic('aperture', 'slit', 'Entrance slit', -150, -54, 0, { radius: 22, opening: 44, openingWidth: 14, openingHeight: 18 }),
    optic('mirror', 'sample', 'Specular sample', 20, -54, -45, { radius: 30, reflectivity: 0.8 }),
    optic('detector', 'detector', 'Reflectance detector', 20, 170, 90, { width: 46, height: 32, columns: 24, rows: 16 }),
  ];
}

const stationNames = {
  array: 'Array spectrometer', uv: 'UV–Vis', pl: 'Steady-state PL', trpl: 'TRPL', raman: 'Confocal Raman',
  ftir: 'FTIR', ellipsometry: 'Ellipsometer', ta: 'Transient absorption', thz: 'THz-TDS',
};

function launchWavelength(id, partId, settings) {
  if (partId === 'emitter') return 300000;
  if (partId === 'sample') return Number(settings.detection) || 520;
  if (id === 'ftir') return 6500;
  if (id === 'thz' || id === 'ta') return 800;
  return Number(settings.excitation) || 532;
}

function genericEditable(id, trace, nominalTrace, settings) {
  const { axes, branches } = layoutDirections(nominalTrace);
  const parts = [];
  for (const part of trace.parts) {
    if (part.kind === 'electronics') continue;
    const path = axes.get(part.id);
    const [x, y] = tablePoint(part.point);
    const launch = branches.get(part.id);
    const { incoming, outgoing } = path ?? {};
    const directionIn = incoming ?? outgoing ?? launch ?? [1, 0];
    const directionOut = (part.kind === 'splitter' && launch) || outgoing || directionIn;
    const fold = Math.hypot(...subtract(directionIn, directionOut)) > 0.03;
    const angle = yaw(fold ? subtract(directionIn, directionOut) : directionIn);
    const name = part.label || (part.kind === 'mirror' ? 'Fold mirror' : part.kind);
    const emit = (sourceId, sourceName, output) => optic('source', sourceId, sourceName, x, y, yaw(output), {
      wavelength: launchWavelength(id, part.id, settings), radius: 1, divergence: 0.25, samples: 19,
      power: part.kind === 'source' ? 1 : 0.05,
    });
    if (part.kind === 'source') {
      parts.push(emit(part.id, name, launch ?? directionOut));
      continue;
    }
    if (launch && ['sample', 'antenna'].includes(part.kind)) parts.push(emit(part.id + '-beam', name + ' beam', launch));
    if (part.kind === 'detector' || (part.kind === 'antenna' && !launch)) {
      parts.push(optic('detector', part.id, name, x, y, yaw(directionIn), { width: 46, height: 34, columns: 32, rows: 16 }));
    } else if (part.kind === 'splitter') {
      parts.push(optic('splitter', part.id, name, x, y, angle, { radius: 27, reflectivity: 0.45, transmission: 0.55 }));
    } else if (fold && ['mirror', 'grating', 'sample', 'delay'].includes(part.kind)) {
      parts.push(optic('mirror', part.id, name, x, y, angle, { radius: 27, reflectivity: 0.95 }));
    } else if (part.kind === 'lens') {
      parts.push(optic('lens', part.id, name, x, y, yaw(directionIn), { radius: 27, focalLength: 120 }));
    } else if (part.kind === 'filter' || part.kind === 'polarizer') {
      parts.push(optic('filter', part.id, name, x, y, yaw(directionIn), {
        radius: 26, centerWavelength: launchWavelength(id, part.id, settings), bandwidth: 10000, enabled: part.disabled !== true,
      }));
    } else {
      parts.push(optic('aperture', part.id, name, x, y, yaw(directionIn), { radius: 27, opening: part.kind === 'slit' ? 20 : 54 }));
    }
  }
  return parts;
}

export function convertInstrumentBench(instrumentId, settings = {}) {
  if (!Object.hasOwn(stationNames, instrumentId)) return createBenchPreset();
  const trace = traceBench(instrumentId, settings);
  const nominal = traceBench(instrumentId, { ...settings, positions: undefined });
  // Bench copies are geometric layouts. The instrument retains its separate
  // response, coherence, polarization, fluorescence and timing calculations.
  let parts;
  if (instrumentId === 'array') parts = editableArray(trace, settings);
  else if (instrumentId === 'raman') parts = editableRaman(settings);
  else if (instrumentId === 'uv' && settings.mode === 'sphere') parts = editableReflectance();
  else parts = genericEditable(instrumentId, trace, nominal, settings);
  return { id: instrumentId, name: stationNames[instrumentId], parts };
}
