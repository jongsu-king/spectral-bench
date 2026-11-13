import { createPart, partAxes, traceScene } from './optics3d.js';
import { convertInstrumentBench } from './presets3d.js';

const LIGHT_MM_PER_PS = 0.299792458;
const MIN_POWER = 1e-12;
const lampLines = [[405, 0.65], [436, 0.83], [546, 1], [578, 0.62], [630, 0.5]];
const spectralIds = new Set(['uv', 'pl', 'raman', 'ellipsometry', 'ta']);

export const measurementPaths = {
  array: { signal: { source: 'fiber', sourcePrefix: 'fiber-band-', target: 'detector', detector: true } },
  uv: { signal: { source: 'lamp', target: 'detector', detector: true, via: ['sample'] } },
  pl: {
    excitation: { source: 'source', target: 'sample' },
    signal: { source: 'sample-beam', target: 'detector', detector: true },
  },
  trpl: {
    excitation: { source: 'source', target: 'sample' },
    signal: { source: 'sample-beam', target: 'detector', detector: true },
  },
  raman: {
    excitation: { source: 'laser', target: 'sample' },
    signal: { source: 'scattering', target: 'detector', detector: true },
  },
  ftir: {
    moving: { source: 'source', target: 'detector', detector: true, via: ['moving', 'sample'] },
    fixed: { source: 'source', target: 'detector', detector: true, via: ['fixed', 'sample'] },
  },
  ellipsometry: {
    sample: { source: 'source', target: 'sample' },
    signal: { source: 'source', target: 'detector', detector: true, via: ['sample'] },
  },
  ta: {
    pump: { source: 'source', target: 'sample', via: ['pump'] },
    generation: { source: 'source', target: 'continuum', detector: true },
    probe: { source: 'continuum-beam', target: 'sample', via: ['probe'] },
    signal: { source: 'continuum-beam', target: 'detector', detector: true, via: ['probe', 'sample'] },
  },
  thz: {
    pump: { source: 'source', target: 'emitter', detector: true },
    gate: { source: 'source', target: 'receiver', detector: true, via: ['gate'] },
    signal: { source: 'emitter-beam', target: 'receiver', detector: true, via: ['sample'] },
  },
};

const bands = (first, last, count, convert = value => value) => Array.from({ length: count }, (_, index) => ({
  wavelength: convert(first + (last - first) * index / (count - 1)), power: 1,
}));
const range = (value, min, max) => Math.max(min, Math.min(max, value));
const difference = (a, b) => a.map((value, index) => value - b[index]);
const dot = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
const findPart = (scene, id) => scene.parts.find(part => part.id === id);
const whiteLines = bands(380, 750, 186).map(({ wavelength }) => ({
  wavelength, power: 0.19 * Math.exp(-0.5 * ((wavelength - 582) / 111) ** 2) + 0.035,
}));
const whitePreview = whiteLines.filter((_, index) => index % 9 === 0 || index === whiteLines.length - 1);
const totalLinePower = lines => lines.reduce((sum, line) => sum + line.power, 0);

export function createInstrumentScene(id, settings = {}) {
  const layout = convertInstrumentBench(id, id === 'ta' ? { ...settings, pump: true } : settings);
  const source = findPart(layout, 'source');
  if (id === 'array' && settings.source === 'white') findPart(layout, 'fiber').spectrum = whitePreview;
  if (id === 'uv') findPart(layout, 'lamp').spectrum = bands(280, 780, 24);
  if (id === 'pl') findPart(layout, 'sample-beam').spectrum = bands(340, 780, 24);
  if (id === 'pl' || id === 'trpl') source.wavelength = Number(settings.excitation) || 405;
  if (id === 'ftir') source.spectrum = bands(5000, 400, 20, wavenumber => 1e7 / wavenumber);
  if (id === 'ellipsometry') source.spectrum = bands(380, 820, 24);
  if (id === 'ta') {
    const continuum = findPart(layout, 'continuum');
    Object.assign(continuum, { type: 'detector', width: 52, height: 52, columns: 8, rows: 8 });
    layout.parts.push({
      ...createPart('source', 'continuum-beam', continuum.position),
      name: 'White-light probe', rotation: [...continuum.rotation], radius: 1, divergence: 0.25,
      samples: 19, power: 0.495, spectrum: bands(410, 780, 24),
    });
  }
  if (id === 'raman') {
    const laser = Number(settings.laser) || 532;
    const wavelengthAt = shift => 1e7 / (1e7 / laser - shift);
    const scattering = findPart(layout, 'scattering');
    scattering.spectrum = bands(-100, 3450, 24, wavelengthAt);
    // Rayleigh rejection is evaluated by the instrument model. The collection
    // filter is a broad geometric relay in the finite-aperture ray calculation.
    findPart(layout, 'filter').bandwidth = 1200;
    const grating = findPart(layout, 'grating');
    const detector = findPart(layout, 'detector');
    const low = Math.asin(wavelengthAt(-100) * grating.grooveDensity / 1e6);
    const high = Math.asin(wavelengthAt(3450) * grating.grooveDensity / 1e6);
    const angle = (low + high) / 2;
    const distance = 210;
    detector.position = [grating.position[0] + distance * Math.cos(angle), grating.position[1] + distance * Math.sin(angle), grating.position[2]];
    detector.rotation = [0, 0, angle * 180 / Math.PI];
    detector.width = Math.max(detector.width, 2 * distance * Math.tan((high - low) / 2) + 12);
  }
  if (id === 'thz') {
    const emitter = findPart(layout, 'emitter');
    const receiver = findPart(layout, 'receiver');
    Object.assign(emitter, { type: 'detector', width: 46, height: 34, columns: 8, rows: 4 });
    // The pump terminates at the emitter. The receiver accepts both the THz
    // field from the left and the optical gate from the perpendicular arm.
    receiver.rotation = [0, 0, -45];
    findPart(layout, 'emitter-beam').spectrum = bands(3.5, 0.15, 12, frequency => 299792.458 / frequency);
  }
  const alignment = Number(settings.alignment) || 0;
  const incomingId = { array: 'fiber', uv: 'lamp', raman: 'laser' }[id] ?? 'source';
  const incoming = findPart(layout, incomingId);
  if (incoming && alignment) incoming.rotation[2] += 2 * alignment;
  return layout;
}

function acquisitionScene(id, settings, scene, nominal, mode) {
  const attachment = {
    thz: ['emitter-beam', 'emitter'], raman: ['scattering', 'sample'], ta: ['continuum-beam', 'continuum'],
  }[id] ?? ['sample-beam', 'sample'];
  const [secondaryId, parentId] = attachment;
  const secondary = findPart(scene, secondaryId);
  const nominalSecondary = findPart(nominal, secondaryId);
  const parent = findPart(scene, parentId);
  const nominalParent = findPart(nominal, parentId);
  const useLamp = id === 'array' && (mode === 'reference' || mode === 'calibration');
  const parts = scene.parts.map(part => {
    if (useLamp && part.id === 'fiber') {
      return { ...part, spectrum: lampLines.map(([wavelength, power]) => ({ wavelength, power })) };
    }
    if (id === 'ta' && settings.pump === false && part.id === 'splitter') return { ...part, reflectivity: 0 };
    if (part !== secondary || !nominalSecondary || !nominalParent) return part;
    if (!parent || parent.enabled === false) return { ...part, enabled: false };
    // The emission launch follows the sample or emitter. Its own translation
    // remains available to adjust the launch position independently.
    const attached = { ...part, position: part.position.map((value, index) => value + parent.position[index] - nominalParent.position[index]) };
    if (id === 'trpl' && mode === 'reference') attached.wavelength = Number(settings.excitation) || 405;
    return attached;
  });
  return { ...scene, parts };
}

function denseArraySource(scene, settings, mode) {
  if (settings.source !== 'white' || mode === 'reference' || mode === 'calibration') return { scene, linePower: null };
  const fiber = findPart(scene, 'fiber');
  if (JSON.stringify(fiber?.spectrum) !== JSON.stringify(whitePreview)) return { scene, linePower: null };
  const linePower = totalLinePower(whiteLines);
  const sources = [];
  for (let index = 0; index < whiteLines.length; index += 24) {
    const spectrum = whiteLines.slice(index, index + 24);
    sources.push({ ...fiber, id: index === 0 ? fiber.id : 'fiber-band-' + index, spectrum, power: (fiber.power ?? 1) * totalLinePower(spectrum) / linePower });
  }
  return { scene: { ...scene, parts: scene.parts.flatMap(part => part === fiber ? sources : [part]) }, linePower };
}

function incomingAngle(ray, hitIndex, normal) {
  const direction = difference(ray.points[hitIndex + 1], ray.points[hitIndex]);
  const cosine = Math.abs(dot(direction, normal)) / Math.hypot(...direction);
  return Math.acos(range(cosine, 0, 1)) * 180 / Math.PI;
}

function summarizePath(trace, scene, definition, weighted) {
  const target = findPart(scene, definition.target);
  const reading = trace.detectors.find(detector => detector.id === definition.target);
  const axes = target && partAxes(target);
  const spectrum = new Map();
  const counted = new Set();
  let power = 0;
  let rawPower = 0;
  let distance = 0;
  let incidence = 0;
  const centroid = [0, 0, 0];
  for (const ray of trace.rays) {
    const sourceMatches = ray.sourceId === definition.source || (definition.sourcePrefix && ray.sourceId.startsWith(definition.sourcePrefix));
    if (!axes || !sourceMatches || (definition.detector && ray.detectorId !== definition.target)) continue;
    const index = definition.detector ? ray.interactions.length - 1 : ray.interactions.findIndex(hit => hit.partId === definition.target);
    const hit = ray.interactions[index];
    if (!hit || counted.has(hit)) continue;
    if (definition.via?.some(id => !ray.interactions.slice(0, index).some(event => event.partId === id))) continue;
    if (hit.inputPower <= MIN_POWER) continue;
    counted.add(hit);
    let gain = 1;
    if (weighted && definition.detector && reading) {
      const offset = difference(hit.point, target.position);
      const u = 2 * dot(offset, axes.u) / reading.width;
      const v = 2 * dot(offset, axes.v) / reading.height;
      gain = Math.exp(-0.5 * (u * u + v * v));
    }
    const contribution = hit.inputPower * gain;
    rawPower += hit.inputPower;
    power += contribution;
    distance += contribution * hit.pathLength;
    incidence += contribution * incomingAngle(ray, index, axes.normal);
    hit.point.forEach((value, axis) => { centroid[axis] += contribution * value; });
    spectrum.set(ray.wavelength, (spectrum.get(ray.wavelength) ?? 0) + contribution);
  }
  return {
    power, rawPower, count: counted.size,
    distance: power > MIN_POWER ? distance / power : null,
    centroid: power > MIN_POWER ? centroid.map(value => value / power) : null,
    incidence: power > MIN_POWER ? incidence / power : null,
    spectrum: [...spectrum].sort(([a], [b]) => a - b).map(([wavelength, value]) => ({ wavelength, power: value })),
  };
}

function tracePaths(id, scene) {
  const trace = traceScene(scene);
  const paths = Object.fromEntries(Object.entries(measurementPaths[id] ?? {}).map(([key, definition]) => [
    key, summarizePath(trace, scene, definition, id !== 'array'),
  ]));
  return { trace, paths };
}

const nominalCache = new Map();

function traceNominal(id, mode, scene) {
  const key = id + '/' + mode;
  const layout = JSON.stringify(scene);
  const cached = nominalCache.get(key);
  if (cached?.layout === layout) return cached.result;
  const result = tracePaths(id, scene);
  nominalCache.set(key, { layout, result });
  return result;
}

function interpolate(samples, wavelength) {
  if (!samples.length) return 0;
  if (wavelength <= samples[0].wavelength) return samples[0].power;
  if (wavelength >= samples.at(-1).wavelength) return samples.at(-1).power;
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const middle = (lo + hi) >> 1;
    if (samples[middle].wavelength <= wavelength) lo = middle;
    else hi = middle;
  }
  const a = samples[lo];
  const b = samples[hi];
  return a.power + (b.power - a.power) * (wavelength - a.wavelength) / (b.wavelength - a.wavelength);
}

function relativeSpectrum(signal, baseline, coupling) {
  const wavelengths = [...new Set([...signal.spectrum, ...baseline.spectrum].map(line => line.wavelength))].sort((a, b) => a - b);
  const received = new Map(signal.spectrum.map(({ wavelength, power }) => [wavelength, power]));
  return wavelengths.map(wavelength => {
    const nominal = interpolate(baseline.spectrum, wavelength);
    return { wavelength, power: nominal > MIN_POWER && coupling > MIN_POWER ? (received.get(wavelength) ?? 0) / nominal / coupling : 0 };
  });
}

function arrayReadoutChanged(reading, nominal) {
  if (!reading || reading.width !== nominal.width || reading.hits.length !== nominal.hits.length) return true;
  return reading.hits.some(({ wavelength, u, power }, index) => {
    const base = nominal.hits[index];
    return wavelength !== base.wavelength || Math.abs(u - base.u) > 1e-10 || Math.abs(power - base.power) > 1e-10;
  });
}

function gain(path, baseline) {
  return baseline.power > MIN_POWER ? path.power / baseline.power : 0;
}

function pathChange(path, baseline) {
  return path.distance === null || baseline.distance === null ? 0 : path.distance - baseline.distance;
}

function differenceOfCentroids(currentA, currentB, nominalA, nominalB) {
  if (![currentA, currentB, nominalA, nominalB].every(path => path.centroid)) return 0;
  return Math.hypot(...difference(difference(currentA.centroid, currentB.centroid), difference(nominalA.centroid, nominalB.centroid)));
}

function signalGeometry(id, settings, paths, nominalPaths) {
  const geometry = {};
  let coupling = paths.signal ? gain(paths.signal, nominalPaths.signal) : 1;
  if (paths.excitation) geometry.excitationCoupling = gain(paths.excitation, nominalPaths.excitation);
  if (id === 'trpl') {
    geometry.trplDelayOffset = (pathChange(paths.excitation, nominalPaths.excitation) + pathChange(paths.signal, nominalPaths.signal)) / (LIGHT_MM_PER_PS * 1000);
  }
  if (id === 'ftir') {
    coupling = Math.sqrt(gain(paths.moving, nominalPaths.moving) * gain(paths.fixed, nominalPaths.fixed));
    const total = paths.moving.power + paths.fixed.power;
    geometry.ftirArmVisibility = total > MIN_POWER ? 2 * Math.sqrt(paths.moving.power * paths.fixed.power) / total : 0;
    geometry.ftirOpdOffset = 1000 * (pathChange(paths.moving, nominalPaths.moving) - pathChange(paths.fixed, nominalPaths.fixed));
  }
  if (id === 'ellipsometry') {
    const angle = Number(settings.incidenceAngle) || 65;
    geometry.incidenceAngle = paths.sample.incidence === null || nominalPaths.sample.incidence === null
      ? angle : range(angle + paths.sample.incidence - nominalPaths.sample.incidence, 0.01, 89.99);
  }
  if (id === 'ta') {
    coupling *= gain(paths.generation, nominalPaths.generation);
    geometry.pumpCoupling = settings.pump === false ? 0 : gain(paths.pump, nominalPaths.pump);
    const pumpDelta = pathChange(paths.pump, nominalPaths.pump);
    const probeDelta = pathChange(paths.probe, nominalPaths.probe) + pathChange(paths.generation, nominalPaths.generation);
    geometry.taDelayOffset = (pumpDelta - probeDelta) / LIGHT_MM_PER_PS;
    geometry.taOffset = 1000 * differenceOfCentroids(paths.pump, paths.probe, nominalPaths.pump, nominalPaths.probe);
  }
  if (id === 'thz') {
    const pump = gain(paths.pump, nominalPaths.pump);
    const gate = gain(paths.gate, nominalPaths.gate);
    coupling = Math.sqrt(coupling) * pump * gate;
    geometry.pumpCoupling = pump;
    geometry.gateCoupling = gate;
    geometry.thzStageOffset = 500 * (pathChange(paths.gate, nominalPaths.gate) - pathChange(paths.pump, nominalPaths.pump) - pathChange(paths.signal, nominalPaths.signal));
  }
  return { coupling, geometry };
}

export function traceInstrumentOptics(id, settings = {}, layout, mode = 'sample') {
  const nominal = createInstrumentScene(id, { ...settings, alignment: 0, positions: undefined });
  const scene = layout ?? (settings.alignment || settings.positions ? createInstrumentScene(id, settings) : nominal);
  const operatingScene = acquisitionScene(id, settings, scene, nominal, mode);
  const nominalScene = acquisitionScene(id, settings, nominal, nominal, mode);
  const measured = id === 'array' ? denseArraySource(operatingScene, settings, mode) : { scene: operatingScene };
  const baseline = id === 'array' ? denseArraySource(nominalScene, settings, mode) : { scene: nominalScene };
  const { trace: baselineTrace, paths: nominalPaths } = traceNominal(id, mode, baseline.scene);
  const { trace, paths } = scene === nominal ? { trace: baselineTrace, paths: nominalPaths } : tracePaths(id, measured.scene);
  const { coupling, geometry } = signalGeometry(id, settings, paths, nominalPaths);
  const spectralSamples = spectralIds.has(id)
    ? relativeSpectrum(paths.signal, nominalPaths.signal, gain(paths.signal, nominalPaths.signal)) : [];
  if (id === 'array') {
    const nominalLamp = acquisitionScene(id, settings, nominal, nominal, 'reference');
    const detector = trace.detectors.find(reading => reading.id === 'detector');
    const nominalDetector = baselineTrace.detectors.find(reading => reading.id === 'detector');
    if (arrayReadoutChanged(detector, nominalDetector)) {
      geometry.arrayDetector = detector ?? { id: 'detector', width: nominalDetector.width, hits: [] };
      geometry.arrayCalibration = traceNominal(id, 'reference', nominalLamp).trace.detectors.find(reading => reading.id === 'detector');
      const lines = findPart(operatingScene, 'fiber')?.spectrum;
      geometry.arrayGain = 1300 * (measured.linePower ?? (lines?.length ? totalLinePower(lines) : 1));
    }
  }
  return {
    ...trace, scene, parts: operatingScene.parts, traceScene: measured.scene,
    coupling, geometry,
    spectralThroughput: wavelength => spectralSamples.length ? interpolate(spectralSamples, wavelength) : 1,
    opticalTransfer: { coupling, geometry, spectralSamples, paths, nominalPaths },
  };
}
