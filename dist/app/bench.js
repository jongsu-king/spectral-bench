import { ARRAY_OPTICS, arrayComponentPositions, arrayDetectorHits } from './models-optical.js';

const WIDTH = 860;
const HEIGHT = 330;
const activeDrags = new WeakMap();
const movedClicks = new WeakMap();
const radians = (angle) => angle * Math.PI / 180;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const plus = ([x, y], [u, v]) => [x + u, y + v];
const minus = ([x, y], [u, v]) => [x - u, y - v];
const scale = ([x, y], k) => [x * k, y * k];
const dot = ([x, y], [u, v]) => x * u + y * v;
const cross = ([x, y], [u, v]) => x * v - y * u;
const normalTo = ([x, y]) => [-y, x];
const unit = (vector) => scale(vector, 1 / (Math.hypot(...vector) || 1));
const bearing = (angle) => [Math.cos(angle), Math.sin(angle)];
const rotate = (vector, angle) => plus(scale(vector, Math.cos(angle)), scale(normalTo(vector), Math.sin(angle)));

const colors = {
  white: '#fff4d8', violet: '#b7a0ff', blue: '#80b6ff', cyan: '#67eee2',
  lime: '#d7ff61', orange: '#ffab7a', rose: '#ff87af',
};

const role = {
  source: 'Supplies the wavelength range and timing required for the measurement.',
  slit: 'Limits the beam width. A narrower slit reduces optical throughput.',
  mirror: 'Reflects rays at equal angles of incidence and reflection.',
  lens: 'Collimates the beam or brings the rays to a focus.',
  grating: 'Disperses wavelengths according to groove spacing and incidence angle.',
  sample: 'Absorbs or reflects incident light and can emit or scatter light depending on the measurement.',
  detector: 'Converts light that reaches the active area into an electrical signal.',
  filter: 'Transmits a selected wavelength band and suppresses excitation or stray light.',
  splitter: 'Divides the beam into transmitted and reflected paths.',
  delay: 'Varies the optical path length to control pulse arrival time.',
  sphere: 'Collects light from the sample by repeated diffuse reflection from the highly reflective wall.',
  polarizer: 'Transmits the electric-field component along the polarization axis.',
  antenna: 'A short optical pulse gates the photoconductive antenna.',
  electronics: 'Records the delay between the synchronization and detection signals.',
  atr: 'The evanescent field at the total internal reflection interface probes the sample in contact with the crystal.',
};

function part(id, kind, label, x, y, options = {}) {
  return { id, kind, label, point: [x, y], description: role[kind], ...options };
}

function route(ids, color, options = {}) {
  return { ids, color, ...options };
}

function sceneFor(id, settings) {
  const horizontal = 177;
  switch (id) {
    case 'array': return arrayScene();
    case 'uv': {
      const sphere = settings.mode === 'sphere';
      return {
        parts: [
          part('lamp', 'source', 'Broadband lamp', 80, horizontal),
          part('slit', 'slit', 'Entrance slit', 198, horizontal),
          part('grating', 'grating', 'Diffraction grating', 319, horizontal),
          part('exit', 'slit', 'Exit slit', 447, horizontal),
          ...(sphere
            ? [part('sphere', 'sphere', 'Integrating sphere', 665, horizontal, { labelX: -18, labelY: 91 }),
               part('sample', 'sample', 'Reflectance sample', 716, horizontal, { labelX: 18, labelY: 114 }),
               part('detector', 'detector', 'Detector', 665, 122, { labelY: -34 })]
            : [part('sample', 'sample', 'Cuvette', 571, horizontal),
               part('detector', 'detector', 'Detector', 743, horizontal)]),
        ],
        routes: [route(['lamp', 'slit', 'grating', 'exit', 'sample', ...(sphere ? [] : ['detector'])], colors.cyan, { main: true })],
        sphere,
      };
    }
    case 'pl':
    case 'trpl': {
      const timed = id === 'trpl';
      return {
        parts: [
          part('source', 'source', timed ? 'Pulsed laser' : 'Xe lamp', 84, 114, { labelY: -38 }),
          part('excitation', timed ? 'splitter' : 'grating', timed ? 'Sync pickoff' : 'Excitation monochromator', 243, 114, { labelY: -38 }),
          part('sample', 'sample', 'Fluorescent sample', 429, 114, { labelY: -38 }),
          part('filter', 'filter', 'Emission filter', 429, 182, { labelX: 63, labelY: 5, angle: 90, disabled: settings.filter === false }),
          part('collection', 'grating', 'Emission monochromator', 429, 248),
          part('detector', 'detector', timed ? 'Single-photon detector' : 'PMT', 736, 248),
          ...(timed ? [part('timer', 'electronics', 'TCSPC', 183, 249)] : []),
        ],
        routes: [
          route(['source', 'excitation', 'sample'], wavelengthColor(settings.excitation ?? 405), { main: true }),
          route(['sample', 'filter', 'collection', 'detector'], wavelengthColor(settings.detection ?? 520), { strength: 0.88, transmission: true }),
        ],
        guides: timed ? [
          { points: [[243, 131], [243, 207], [183, 207], [183, 227]] },
          { points: [[736, 275], [736, 313], [183, 313], [183, 272]] },
        ] : [{ points: [[447, 114], [466, 114], [466, 133], [447, 133]] }],
      };
    }
    case 'raman': {
      const laser = Number(settings.laser) || 532;
      const focus = clamp((Number(settings.focus) || 0) * 2, -13, 13);
      return {
        parts: [
          part('laser', 'source', 'Laser', 78, 107, { labelY: -39 }),
          part('splitter', 'splitter', 'Dichroic', 279, 107, { labelY: -39 }),
          part('objective', 'lens', 'Objective', 279, 183, { labelX: -69, labelY: 5, angle: 90 }),
          part('sample', 'sample', 'Sample', 279, 252 + focus, { labelY: 45 }),
          part('filter', 'filter', 'Rayleigh filter', 431, 107, { labelY: -39, disabled: settings.filter === false }),
          part('grating', 'grating', 'Diffraction grating', 565, 107, { labelY: -39 }),
          part('detector', 'detector', 'Linear CCD', 750, 107, { labelY: -39 }),
        ],
        routes: [
          route(['laser', 'splitter', 'objective', 'sample'], wavelengthColor(laser), { main: true }),
          route(['sample', 'objective', 'splitter', 'filter', 'grating', 'detector'], colors.lime, { strength: 0.8, transmission: true }),
        ],
      };
    }
    case 'ftir': {
      const travel = ((settings.mirrorTravel ?? 320) - 320) / 18;
      const atr = settings.mode === 'atr';
      return {
        parts: [
          part('source', 'source', 'IR source', 73, 156),
          part('splitter', 'splitter', 'Beam splitter', 263, 156, { labelX: 76, labelY: -21 }),
          part('moving', 'mirror', 'Moving mirror', 263, 63 - travel, { angle: 90, labelX: 72, labelY: 4 }),
          part('fixed', 'mirror', 'Fixed mirror', 519, 156),
          part('fold', 'mirror', 'Mirror', 263, 254),
          part('sample', atr ? 'atr' : 'sample', atr ? 'ATR crystal' : 'Transmission sample', 526, 254),
          part('detector', 'detector', 'IR detector', 751, 254),
        ],
        routes: [
          route(['source', 'splitter', 'fold', 'sample', 'detector'], colors.orange, { main: true }),
          route(['splitter', 'moving', 'splitter'], colors.rose, { strength: 0.8, width: 4, arm: 'moving' }),
          route(['splitter', 'fixed', 'splitter'], colors.orange, { strength: 0.8, width: 4, arm: 'fixed' }),
        ],
        guides: [{ points: [[247, 43], [279, 43]] }],
      };
    }
    case 'ellipsometry': {
      const incidence = radians(clamp(Number(settings.incidenceAngle) || 65, 42, 85));
      const sample = [429, 231];
      const pathPoint = (distance, sign) => plus(sample, [sign * Math.sin(incidence) * distance, -Math.cos(incidence) * distance]);
      return {
        parts: [
          part('source', 'source', 'Source', ...pathPoint(276, -1), { labelY: -42 }),
          part('polarizer', 'polarizer', 'Polarizer', ...pathPoint(147, -1), { labelY: -39 }),
          part('sample', 'sample', 'Thin film', ...sample, { labelY: 48, angle: 90, reflecting: true }),
          part('analyzer', 'polarizer', 'Analyzer', ...pathPoint(147, 1), { labelY: -39, rotation: settings.analyzerAngle }),
          part('detector', 'detector', 'Spectrometer', ...pathPoint(276, 1), { labelY: -42 }),
        ],
        routes: [route(['source', 'polarizer', 'sample', 'analyzer', 'detector'], colors.cyan, { main: true })],
        guides: [{ points: [[429, 225], [429, 136]] }],
      };
    }
    case 'ta': {
      const delay = clamp(Number(settings.delay) || 0, -15, 15);
      const offset = clamp((Number(settings.offset) || 0) / 7, -34, 34);
      return {
        parts: [
          part('source', 'source', 'Femtosecond laser', 80, 100, { labelY: -40 }),
          part('splitter', 'splitter', 'Beam splitter', 229, 100, { labelY: -40 }),
          part('continuum', 'filter', 'Continuum generator', 383, 100, { labelY: -40, description: 'Generates a broadband probe from the incident ultrafast pulse.' }),
          part('probe', 'mirror', 'Probe mirror', 529, 100, { labelY: -40 }),
          part('fold', 'mirror', 'Pump mirror', 229, 249),
          part('delay', 'delay', 'Delay stage', 386 + delay, 249),
          part('pump', 'mirror', 'Pump steering', 529, 249),
          part('sample', 'sample', 'Sample', 643, 174, { labelY: 47 }),
          part('detector', 'detector', 'Spectrometer', 772, 258),
        ],
        routes: [
          route(['source', 'splitter', 'continuum', 'probe', 'sample', 'detector'], colors.cyan, { main: true }),
          ...(settings.pump === false ? [] : [route(['splitter', 'fold', 'delay', 'pump', 'sample'], colors.violet, {
            endOffset: offset, strength: 0.4 + 0.48 * clamp((settings.fluence ?? 30) / 60, 0, 1), pump: true,
          })]),
        ],
      };
    }
    case 'thz': {
      const stage = clamp(((settings.stage ?? 1170) - 900) / 37, -25, 25);
      return {
        parts: [
          part('source', 'source', 'Femtosecond laser', 79, 95, { labelY: -43 }),
          part('splitter', 'splitter', 'Beam splitter', 211, 95, { labelY: -40 }),
          part('emitter', 'antenna', 'Emitter PCA', 334, 95, { labelY: -40, description: 'An optical pump pulse activates the biased photoconductive antenna and generates a terahertz pulse.' }),
          part('mirror1', 'mirror', 'Parabolic mirror', 431, 95, { labelX: 34, labelY: -39 }),
          part('mirror2', 'mirror', '', 431, 195),
          part('sample', 'sample', 'Sample', 543, 195, { labelY: 47 }),
          part('mirror3', 'mirror', '', 653, 195),
          part('mirror4', 'mirror', 'Parabolic mirror', 653, 95, { labelY: -40 }),
          part('receiver', 'antenna', 'Receiver PCA', 769, 95, { labelY: -40, description: 'The optical gate samples the signed terahertz electric field at the selected delay.' }),
          part('fold', 'mirror', '', 211, 220),
          part('delay', 'delay', 'Double-pass delay', 352 + stage, 220, { labelX: 10, labelY: -30 }),
          part('retro', 'mirror', '', 352 + stage, 264),
          part('return', 'mirror', '', 246, 264),
          part('transfer', 'mirror', '', 246, 303),
          part('gate', 'mirror', '', 769, 303),
        ],
        routes: [
          route(['source', 'splitter', 'emitter'], colors.violet, { strength: 0.9, transmission: true }),
          route(['emitter', 'mirror1', 'mirror2', 'sample', 'mirror3', 'mirror4', 'receiver'], colors.orange, { main: true }),
          route(['splitter', 'fold', 'delay', 'retro', 'return', 'transfer', 'gate', 'receiver'], colors.violet, { strength: 0.8, gate: true }),
        ],
      };
    }
    default: return { parts: [], routes: [] };
  }
}

function wavelengthColor(wavelength) {
  const value = Number(wavelength);
  if (value < 435) return colors.violet;
  if (value < 480) return colors.blue;
  if (value < 510) return colors.cyan;
  if (value < 575) return colors.lime;
  if (value < 610) return colors.orange;
  return colors.rose;
}

function arrayScene() {
  const positions = arrayComponentPositions();
  const outgoingAngle = ARRAY_OPTICS.nominalBeta / radians(1);
  return {
    parts: [
      part('fiber', 'source', 'Optical fiber', ...positions.fiber, { labelY: 49 }),
      part('slit', 'slit', 'Entrance slit', ...positions.slit, { angle: -15 }),
      part('collimator', 'lens', 'Collimator', ...positions.collimator, { angle: -15 }),
      part('grating', 'grating', 'Diffraction grating', ...positions.grating, { labelY: -51 }),
      part('focus', 'lens', 'Focusing optics', ...positions.focus, { angle: outgoingAngle, labelY: -54 }),
      part('detector', 'detector', 'Linear CCD', ...positions.detector, { angle: outgoingAngle, labelY: 56, linear: true }),
    ],
    routes: [],
  };
}

function intersect(origin, direction, center, tangent, aperture = Infinity) {
  const denominator = cross(direction, tangent);
  if (Math.abs(denominator) < 1e-8) return null;
  const distance = cross(minus(center, origin), tangent) / denominator;
  if (distance < -0.01) return null;
  const point = plus(origin, scale(direction, distance));
  const offset = dot(minus(point, center), tangent);
  return { point, offset, clipped: Math.abs(offset) > aperture };
}

function apertures(component) {
  if (component.kind === 'slit') return 11;
  if (component.kind === 'antenna') return 14;
  if (component.kind === 'detector') return 17;
  return 26;
}

function layoutPoint(position, fallback) {
  if (!Number.isFinite(position?.x) || !Number.isFinite(position?.y)) return fallback;
  return [clamp(position.x, 15, WIDTH - 15), clamp(position.y, 15, HEIGHT - 5)];
}

function movedParts(scene, id, positions = {}) {
  const stage = id === 'thz' && scene.parts.find((component) => component.id === 'delay');
  const stageShift = stage ? minus(layoutPoint(positions.delay, stage.point), stage.point) : [0, 0];
  return scene.parts.map((component) => {
    const position = layoutPoint(positions[component.id], component.point);
    const point = stage && component.id === 'retro' && position === component.point
      ? plus(position, stageShift)
      : position;
    return { ...component, point };
  });
}

function traceRoute(definition, parts, nominal, alignment) {
  const sequence = definition.ids.map((id) => parts.get(id));
  const axes = definition.ids.map((id) => nominal.get(id).point);
  if (definition.endOffset) {
    const last = axes.length - 1;
    const targetAxis = unit(minus(axes[last], axes[last - 1]));
    axes[last] = plus(axes[last], scale(normalTo(targetAxis), definition.endOffset));
  }
  const centralAxis = unit(minus(axes[1], axes[0]));
  const transverse = normalTo(centralAxis);
  const offsets = [-5.5, -2.5, 0, 2.5, 5.5];
  return offsets.map((offset, rayIndex) => {
    let point = plus(sequence[0].point, scale(transverse, offset));
    let direction = rotate(centralAxis, radians(alignment * 2));
    const points = [point];
    const pathParts = [sequence[0].label].filter(Boolean);
    let throughput = 0;
    let detectorHit = false;
    for (let index = 1; index < sequence.length; index += 1) {
      const current = sequence[index];
      const incomingAxis = unit(minus(axes[index], axes[index - 1]));
      const next = sequence[index + 1];
      const outAxis = next && unit(minus(axes[index + 1], axes[index]));
      const folds = outAxis && dot(incomingAxis, outAxis) < 0.999;
      const planeNormal = folds ? unit(minus(incomingAxis, outAxis)) : incomingAxis;
      const tangent = normalTo(planeNormal);
      const hit = intersect(point, direction, current.point, tangent, apertures(current));
      if (!hit) break;
      points.push(hit.point);
      if (current.label) pathParts.push(current.label);
      point = hit.point;
      if (hit.clipped) break;
      if (!next) {
        detectorHit = true;
        throughput = Math.exp(-0.5 * (hit.offset / 13) ** 2);
        break;
      }
      if (folds) direction = minus(direction, scale(planeNormal, 2 * dot(direction, planeNormal)));
      if (current.kind === 'lens') {
        const focal = Math.hypot(...minus(axes[index + 1], axes[index]));
        direction = unit(minus(direction, scale(tangent, hit.offset / focal)));
      }
    }
    return {
      points,
      pathParts,
      detectorHit,
      throughput,
      color: definition.color,
      main: rayIndex === 2,
      alpha: (definition.strength ?? 1) * (rayIndex === 2 ? 1 : 0.31),
      width: definition.width,
    };
  });
}

function sphereRays(scene, settings) {
  const { point: center } = scene.parts.find((component) => component.id === 'sphere');
  const { point: start } = scene.parts.find((component) => component.id === 'sample');
  const { point: detector } = scene.parts.find((component) => component.id === 'detector');
  const sphereRadius = 57;
  if (Math.hypot(...minus(start, center)) >= sphereRadius) return [];
  const random = (value) => Math.sin(value * 31.77 + 0.19) * 15047.993;
  const fraction = (value) => value - Math.floor(value);
  const paths = [];
  for (let ray = 0; ray < 6; ray += 1) {
    let position = start;
    let direction = bearing(Math.PI + (ray - 2.5) * 0.45);
    const points = [start];
    for (let bounce = 0; bounce < 4; bounce += 1) {
      const relative = minus(position, center);
      const tangentDistance = dot(relative, direction);
      const distance = -tangentDistance + Math.sqrt(tangentDistance ** 2 + sphereRadius ** 2 - dot(relative, relative));
      position = plus(position, scale(direction, distance));
      points.push(position);
      if (Math.hypot(...minus(position, detector)) <= 12) break;
      const inward = unit(minus(center, position));
      const scatter = Math.asin(2 * fraction(random(ray * 11 + bounce)) - 1);
      direction = rotate(inward, scatter);
    }
    paths.push({ points, color: colors.cyan, alpha: 0.29, main: false });
  }
  if (settings.specular !== false) {
    paths.push({ points: [start, [center[0] - 53, center[1] - 15], [center[0] - 21, center[1] - 52]], color: colors.lime, alpha: 0.86, main: true });
  }
  return paths;
}

function spherePortCoupling(parts, nominal) {
  const radius = 13;
  const portPower = (id) => {
    const actual = minus(parts.get(id).point, parts.get('sphere').point);
    const baseline = minus(nominal.get(id).point, nominal.get('sphere').point);
    return Math.exp(-0.5 * (Math.hypot(...minus(actual, baseline)) / radius) ** 2);
  };
  return portPower('sample') * portPower('detector');
}

function pathLength(rays) {
  const points = rays.find((ray) => ray.main && ray.detectorHit)?.points;
  if (!points) return null;
  return points.slice(1).reduce((total, point, index) => total + Math.hypot(...minus(point, points[index])), 0);
}

export function traceBench(id, settings = {}) {
  const scene = sceneFor(id, settings);
  const parts = movedParts(scene, id, settings.positions ?? {});
  const layout = { ...scene, parts };
  if (id === 'array') {
    // The detector model already clips each wavelength at the active pixels.
    return { ...layout, rays: arrayRays(undefined, settings), coupling: 1 };
  }
  const actual = new Map(parts.map((component) => [component.id, component]));
  const nominal = new Map(scene.parts.map((component) => [component.id, component]));
  const alignment = clamp(Number(settings.alignment) || 0, -8, 8);
  const rays = [];
  let coupling = 1;
  let pumpCoupling = 1;
  let ftirOpdOffset = 0;
  let thzStageOffset = 0;
  const energy = (beam) => beam.reduce((sum, ray) => sum + ray.throughput, 0);
  for (const definition of scene.routes) {
    const beam = traceRoute(definition, actual, nominal, definition.main ? alignment : 0);
    const baseline = traceRoute(definition, nominal, nominal, 0);
    const baselineEnergy = energy(baseline);
    const gain = baselineEnergy ? clamp(energy(beam) / baselineEnergy, 0, 1) : 1;
    if (definition.main || definition.transmission || definition.gate) coupling *= gain;
    if (definition.pump) pumpCoupling *= gain;
    if (definition.arm || definition.gate) {
      const length = pathLength(beam);
      const referenceLength = pathLength(baseline);
      const displacement = length !== null && referenceLength !== null ? length - referenceLength : 0;
      if (definition.arm) {
        coupling *= Math.sqrt(gain);
        ftirOpdOffset += displacement * (definition.arm === 'moving' ? 18 : -18);
      }
      if (definition.gate) thzStageOffset = displacement * 37 / 2;
    }
    rays.push(...beam);
  }
  if (scene.sphere) {
    coupling *= spherePortCoupling(actual, nominal);
    rays.push(...sphereRays(layout, settings));
  }
  return { ...layout, rays, coupling, pumpCoupling, ftirOpdOffset, thzStageOffset };
}

function arrayRays(result, settings) {
  const fallbackWavelengths = settings.source === 'doublet' ? [546, 577, 579] : [450, 520, 630];
  const hits = result?.bench?.hits ?? fallbackWavelengths.flatMap((wavelength) => arrayDetectorHits(settings, wavelength));
  const groups = new Map();
  for (const hit of hits) {
    if (!Number.isFinite(hit.wavelength) || (hit.points?.length ?? 0) < 2 || !hit.points.every(point => point.every(Number.isFinite))) continue;
    if (!groups.has(hit.wavelength)) groups.set(hit.wavelength, []);
    groups.get(hit.wavelength).push(hit);
  }
  const waveGroups = [...groups.values()];
  const selectedGroups = waveGroups.length <= 11
    ? waveGroups
    : waveGroups.filter((_, index) => index % Math.ceil(waveGroups.length / 11) === 0);
  return selectedGroups.flatMap((group) => {
    group.sort((a, b) => a.offset - b.offset);
    const centerIndex = Math.floor(group.length / 2);
    const offsets = [...new Set([0, centerIndex, group.length - 1])];
    return offsets.map((index) => {
      const hit = group[index];
      const central = index === centerIndex;
      return {
        points: hit.points,
        color: wavelengthColor(hit.wavelength),
        wavelength: hit.wavelength,
        pixel: hit.pixel,
        detectorHit: hit.detectorHit,
        alpha: central ? 0.91 : 0.38,
        main: central,
        array: true,
      };
    });
  });
}

function pathData(points) {
  return points.map(([x, y], index) => (index === 0 ? 'M' : 'L') + x.toFixed(2) + ' ' + y.toFixed(2)).join(' ');
}

function escapeText(text) {
  return String(text ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character]);
}

function instrumentSymbol(component) {
  const rotation = Number(component.rotation) || 0;
  switch (component.kind) {
    case 'source':
      return '<rect x="-20" y="-14" width="33" height="28" rx="5"/><path d="M13 -8h7v16h-7M-12 -6h13m-13 6H6m-18 6H1"/><circle class="emitter" cx="20" cy="0" r="3.6"/>';
    case 'slit':
      return '<rect x="-5.5" y="-25" width="11" height="21" rx="2"/><rect x="-5.5" y="4" width="11" height="21" rx="2"/><path d="M-3 -19h6M-3 19h6"/>';
    case 'grating':
      return '<rect x="-9" y="-27" width="18" height="54" rx="3"/><path d="M-6 -20h12m-12 6h12m-12 6h12m-12 6h12m-12 6h12m-12 6h12m-12 6h12m-12 6h12"/>';
    case 'lens':
      return '<path d="M0 -30Q20 0 0 30Q-20 0 0 -30Z"/><path d="M0 -23v46"/>';
    case 'mirror':
      return '<path d="M-8 -24Q7 0 -8 24L-2 27Q14 0 -2 -27Z"/><path d="M-5 -16l9 -4m-5 12l10 -3M0 0h10M-1 8l10 3m-14 5l9 4"/>';
    case 'splitter':
      return '<path d="M0 -20L20 0 0 20-20 0Z"/><path d="M-11 11L11 -11"/>';
    case 'sample':
      return '<rect x="-12" y="-21" width="24" height="42" rx="3"/><path d="M-8 -9H8M-8 6q8 6 16 0M-8 15H8"/>';
    case 'filter':
      return '<rect x="-9" y="-22" width="18" height="44" rx="3"/><path d="M-5 -13L5 -6M-5 -5l10 7M-5 3l10 7M-5 11l10 7"/>';
    case 'detector':
      if (component.linear) {
        return '<rect x="-8" y="-34" width="20" height="68" rx="4"/><path d="M-4 -31v62M-4 -25h10m-10 7h10m-10 7h10m-10 7h10m-10 7h10m-10 7h10m-10 7h10m-10 7h10m-10 7h10"/>';
      }
      return '<rect x="-12" y="-22" width="26" height="44" rx="4"/><path d="M-7 -16v32M-3 -12h11m-11 6h11m-11 6h11m-11 6h11m-11 6h11"/>';
    case 'polarizer':
      return '<circle r="21"/><g transform="rotate(' + rotation.toFixed(1) + ')"><path d="M-13 0h26M0 -13v26M-9 -9l18 18M-9 9l18-18"/></g>';
    case 'delay':
      return '<rect x="-30" y="-15" width="60" height="30" rx="5"/><path d="M-22 7h44M-22-7h44M-14-7V7M14-7V7M-5 0h10M-3-3l-3 3 3 3M3-3l3 3-3 3"/>';
    case 'antenna':
      return '<rect x="-16" y="-21" width="32" height="42" rx="5"/><path d="M-10-15L-2-2h-8zM10 15L2 2h8z"/><circle class="emitter" r="2.6"/>';
    case 'electronics':
      return '<rect x="-33" y="-17" width="66" height="34" rx="5"/><path d="M-22 6h7l4-10 6 12 6-13 5 8h15"/>';
    case 'atr':
      return '<path d="M-20 12L-10-12h20l10 24z"/><path d="M-12 2l7 4 8-7 8 4M-11-16h22"/>';
    case 'sphere':
      return '<circle r="57"/><path d="M-57-5v10M-5-57h10M53-5v10"/>';
    default: return '';
  }
}

function renderPart(component, selected, draggable) {
  const [x, y] = component.point;
  const angle = Number(component.angle) || 0;
  const label = escapeText(component.label);
  const aria = label || escapeText(component.description);
  const labelX = x + (component.labelX ?? 0);
  const labelY = y + (component.labelY ?? 44);
  const isSphere = component.kind === 'sphere';
  const mountSize = isSphere ? 0 : component.linear ? 30 : 25;
  return '<g class="bench-component' + (selected ? ' is-active' : '') + (component.disabled ? ' is-disabled' : '') + '"' +
    ' data-part="' + component.id + '" role="button" tabindex="0" aria-label="' + aria + '"' +
    ' aria-pressed="' + selected + '"' + (draggable ? ' aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"' : '') + '>' +
    '<title>' + aria + '</title>' +
    '<circle class="bench-target" cx="' + x + '" cy="' + y + '" r="' + (isSphere ? 57 : 28) + '"/>' +
    '<g class="bench-device" transform="translate(' + x + ' ' + y + ') rotate(' + angle.toFixed(1) + ')">' +
    (mountSize ? '<circle class="bench-mount" r="' + mountSize + '"/>' : '') +
    instrumentSymbol(component) + '</g>' +
    (label ? '<text x="' + labelX + '" y="' + labelY + '">' + label + '</text>' : '') +
    '</g>';
}

const benchStyle = `
.optical-bench { display:block; width:100%; min-width:550px; height:auto; }
.optical-bench .bench-component { cursor:pointer; outline:none; }
.optical-bench.is-editable .bench-component { cursor:grab; touch-action:none; user-select:none; }
.optical-bench.is-dragging .bench-component { cursor:grabbing; }
.optical-bench .bench-target { fill:transparent; stroke:transparent; stroke-width:1; }
.optical-bench .bench-device { fill:#202e30; fill-opacity:.78; stroke:#aab8b2; stroke-width:1.55; stroke-linecap:round; stroke-linejoin:round; }
.optical-bench .bench-device .bench-mount { fill:#142024; fill-opacity:.54; stroke:#405151; stroke-width:.8; }
.optical-bench .bench-device path { vector-effect:non-scaling-stroke; }
.optical-bench .bench-device .emitter { stroke:#d7ff61; fill:#d7ff61; }
.optical-bench .bench-component text { fill:#e5e7d8; font:500 14px Geist, Inter, system-ui, sans-serif; text-anchor:middle; paint-order:stroke fill; stroke:#142023; stroke-width:3.2; stroke-linejoin:round; }
.optical-bench .bench-component:hover .bench-target,
.optical-bench .bench-component:focus-visible .bench-target,
.optical-bench .bench-component.is-active .bench-target { stroke:#d7ff61; stroke-dasharray:3 3; }
.optical-bench .bench-component.is-active .bench-device { stroke:#d7ff61; }
.optical-bench .bench-component.is-disabled .bench-device { opacity:.38; }
.optical-bench .bench-guide { fill:none; stroke:#738b8c; stroke-width:1.1; stroke-dasharray:4 5; opacity:.67; }
.optical-bench .bench-ray-hitbox { fill:none; stroke:transparent; stroke-width:12; cursor:crosshair; pointer-events:stroke; outline:none; }
.optical-bench .bench-ray-hitbox:focus-visible { stroke:#ffffff65; }
`;

function nearestProbeRay(rays, probe) {
  if (!probe || !Number.isFinite(probe.x)) return null;
  const chart = String(probe.chart ?? '').toLowerCase();
  const usePixel = chart === 'raw' || chart === 'detector' || chart === '0' || chart.includes('ccd');
  let closest = null;
  let distance = Infinity;
  for (const ray of rays) {
    if (!ray.array || !ray.detectorHit) continue;
    const delta = Math.abs((usePixel ? ray.pixel : ray.wavelength) - probe.x);
    if (delta < distance || (delta === distance && ray.main)) {
      closest = ray;
      distance = delta;
    }
  }
  return closest;
}

function drawRays(rays, selected, probe) {
  const nearest = nearestProbeRay(rays, probe);
  const normal = [];
  const overlays = [];
  rays.forEach((ray, index) => {
    if (ray.points.length < 2) return;
    const highlighted = selected === 'ray-' + index || ray === nearest;
    const muted = nearest && !highlighted;
    const opacity = clamp(ray.alpha * (muted ? 0.45 : 1), 0, 1);
    const width = highlighted ? 3.3 : ray.width ?? (ray.main ? 2.1 : 0.9);
    const path = pathData(ray.points);
    const [endX, endY] = ray.points.at(-1);
    const markup = '<g fill="none" stroke-linecap="round" stroke-linejoin="round">' +
      (ray.main || highlighted
        ? '<path d="' + path + '" stroke="' + ray.color + '" opacity="' + (0.12 * opacity) + '" stroke-width="' + (width + 7) + '"/>'
        : '') +
      '<path d="' + path + '" stroke="' + ray.color + '" opacity="' + opacity + '" stroke-width="' + width + '"/>' +
      (ray.main && ray.detectorHit
        ? '<circle cx="' + endX.toFixed(2) + '" cy="' + endY.toFixed(2) + '" r="' + (highlighted ? 4 : 2.55) + '" fill="' + ray.color + '" opacity="' + opacity + '"/>'
        : '') +
      (ray.main && ray.detectorHit === false
        ? '<path d="M' + (endX - 4) + ' ' + (endY - 4) + 'l8 8m-8 0 8-8" stroke="' + ray.color + '" opacity=".83" stroke-width="1.5"/>'
        : '') + '</g>';
    (highlighted ? overlays : normal).push(markup);
  });
  return normal.join('') + overlays.join('');
}

function guidesMarkup(guides = []) {
  return guides.map(({ points }) => '<path class="bench-guide" d="' + pathData(points) + '"/>').join('');
}

function beginDrag(event, svg, container, id, component, onMove) {
  if (!event.isPrimary || event.button !== 0 || activeDrags.has(container)) return;
  const matrix = svg.getScreenCTM();
  if (!matrix) return;
  movedClicks.delete(container);
  const inverse = matrix.inverse();
  const toBench = (pointer) => new DOMPoint(pointer.clientX, pointer.clientY).matrixTransform(inverse);
  const start = toBench(event);
  const [x, y] = component.point;
  const initial = { x, y };
  let last = initial;
  let moved = false;

  const cleanup = () => {
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', finish, true);
    window.removeEventListener('pointercancel', finish, true);
    window.removeEventListener('keydown', cancel, true);
    window.removeEventListener('blur', abort);
    activeDrags.delete(container);
    container.querySelector('.optical-bench')?.classList.remove('is-dragging');
  };
  const emit = (position, phase) => onMove(component.id, position, phase);
  const move = (pointer) => {
    if (pointer.pointerId !== event.pointerId) return;
    if (!moved && Math.hypot(pointer.clientX - event.clientX, pointer.clientY - event.clientY) < 4) return;
    moved = true;
    pointer.preventDefault();
    container.querySelector('.optical-bench')?.classList.add('is-dragging');
    const current = toBench(pointer);
    const [nextX, nextY] = layoutPoint({ x: x + current.x - start.x, y: y + current.y - start.y }, component.point);
    if (last.x === nextX && last.y === nextY) return;
    last = { x: nextX, y: nextY };
    emit(last, 'preview');
  };
  const finish = (pointer) => {
    if (pointer.pointerId !== event.pointerId) return;
    if (pointer.type === 'pointerup') move(pointer);
    cleanup();
    if (!moved) return;
    movedClicks.set(container, component.id);
    emit(pointer.type === 'pointercancel' ? initial : last, 'commit');
  };
  const abort = () => {
    cleanup();
    if (moved) emit(initial, 'commit');
  };
  const cancel = (key) => {
    if (key.key !== 'Escape') return;
    key.preventDefault();
    abort();
  };
  activeDrags.set(container, { id, cleanup });
  window.addEventListener('pointermove', move, { capture: true, passive: false });
  window.addEventListener('pointerup', finish, true);
  window.addEventListener('pointercancel', finish, true);
  window.addEventListener('keydown', cancel, true);
  window.addEventListener('blur', abort);
}

const arrowDirections = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };

export function renderBench(container, options) {
  const { id, settings = {}, result, trace = traceBench(id, settings), showRays = true, activePart, onSelect, onMove, probe } = options;
  const drag = activeDrags.get(container);
  if (drag && drag.id !== id) drag.cleanup();
  const scroll = container.querySelector('.bench-scroll')?.scrollLeft ?? 0;
  const activeId = typeof activePart === 'string' ? activePart : activePart?.id;
  const rays = id === 'array' && result?.bench?.hits ? arrayRays(result, settings) : trace.rays;
  const focusId = container.contains(document.activeElement)
    ? document.activeElement.getAttribute('data-part') ?? document.activeElement.getAttribute('data-ray')
    : null;
  const previousScroll = container.querySelector('.bench-scroll')?.scrollLeft ?? 0;
  const rayMarkup = showRays ? drawRays(rays, activeId, probe) : '';
  const targets = showRays ? rays.map((ray, index) => ray.main && ray.points.length > 1
    ? '<path class="bench-ray-hitbox" d="' + pathData(ray.points) + '" data-ray="ray-' + index +
      '" tabindex="0" role="button" aria-label="' + (ray.array ? Math.round(ray.wavelength) + ' nm ray' : 'Ray path') + '"/>'
    : '').join('') : '';
  const activeGrating = (component) => id === 'array' && component.id === 'grating'
    ? { ...component, angle: clamp(Number(settings.rotation) || 0, -20, 20) }
    : component;
  const background = `
    <defs>
      <pattern id="bench-minor-grid" width="20" height="20" patternUnits="userSpaceOnUse">
        <path d="M20 0H0V20" fill="none" stroke="#739395" stroke-opacity=".13" stroke-width=".65"/>
      </pattern>
      <pattern id="bench-major-grid" width="100" height="100" patternUnits="userSpaceOnUse">
        <rect width="100" height="100" fill="url(#bench-minor-grid)"/>
        <path d="M100 0H0V100" fill="none" stroke="#7f9f9d" stroke-opacity=".23" stroke-width="1"/>
      </pattern>
      <radialGradient id="bench-light" cx="47%" cy="45%" r="72%">
        <stop offset="0" stop-color="#223638"/>
        <stop offset="1" stop-color="#131f23"/>
      </radialGradient>
    </defs>
    <rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bench-light)"/>
    <rect x="21" y="15" width="${WIDTH - 42}" height="${HEIGHT - 30}" fill="url(#bench-major-grid)" rx="3"/>
  `;
  const parts = trace.parts;
  const sphere = parts.find((component) => component.kind === 'sphere');
  const selectedPart = (component) => renderPart(activeGrating(component), activeId === component.id, Boolean(onMove));
  const classes = ['optical-bench', ...(onMove ? ['is-editable'] : []), ...(activeDrags.has(container) ? ['is-dragging'] : [])];
  container.innerHTML = '<div class="bench-scroll" style="overflow-x:auto;max-width:100%">' +
    '<svg class="' + classes.join(' ') + '" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + WIDTH + ' ' + HEIGHT +
    '" role="group" aria-label="Instrument optical bench">' + '<style>' + benchStyle + '</style>' + background +
    (sphere ? selectedPart(sphere) : '') + guidesMarkup(trace.guides) + rayMarkup + targets +
    parts.filter((component) => component !== sphere).map(selectedPart).join('') + '</svg></div>';

  container.querySelector('.bench-scroll').scrollLeft = previousScroll;
  const svg = container.querySelector('svg');
  container.querySelector('.bench-scroll').scrollLeft = scroll;
  const partFor = (target) => parts.find((entry) => entry.id === target?.getAttribute('data-part'));
  if (onMove) svg.addEventListener('pointerdown', (event) => {
    const component = partFor(event.target.closest('[data-part]'));
    if (component) beginDrag(event, svg, container, id, component, onMove);
  });
  const select = (event) => {
    const target = event.target.closest('[data-part], [data-ray]');
    if (!target) return;
    if (target.hasAttribute('data-part')) {
      const component = partFor(target);
      if (event.type === 'click' && movedClicks.get(container) === component?.id) {
        movedClicks.delete(container);
        return;
      }
      if (component) onSelect?.({ id: component.id, label: component.label || 'Mirror', description: component.description });
      return;
    }
    const rayId = target.getAttribute('data-ray');
    const ray = rays[Number(rayId.slice(4))];
    if (!ray) return;
    const label = ray.array ? Math.round(ray.wavelength) + ' nm ray' : 'Ray path';
    const description = ray.array
      ? (ray.detectorHit
        ? 'The grating directs this ray to CCD pixel ' + Math.round(ray.pixel) + '.'
        : 'This diffracted ray falls outside the active CCD area.')
      : (ray.detectorHit
        ? 'The ray reaches the receiving surface.'
        : 'An aperture blocks the ray or the ray misses the receiving surface.');
    onSelect?.({ id: rayId, label, description });
  };
  svg.addEventListener('click', select);
  svg.addEventListener('keydown', (event) => {
    const direction = arrowDirections[event.key];
    const component = onMove && direction && partFor(event.target);
    if (component) {
      event.preventDefault();
      const [x, y] = plus(component.point, scale(direction, event.shiftKey ? 12 : 3));
      const [nextX, nextY] = layoutPoint({ x, y }, component.point);
      onMove(component.id, { x: nextX, y: nextY }, 'commit');
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (!event.target.matches('[data-part], [data-ray]')) return;
    event.preventDefault();
    select(event);
  });
  if (focusId) {
    const nextFocus = [...svg.querySelectorAll('[data-part], [data-ray]')].find((item) =>
      item.getAttribute('data-part') === focusId || item.getAttribute('data-ray') === focusId);
    nextFocus?.focus({ preventScroll: true });
  }
}
