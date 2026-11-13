const EPSILON = 1e-6;
const DEGREES = Math.PI / 180;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const MAX_INITIAL_RAYS = 3200;
const MAX_PATHS = 6000;
const MIN_POWER = 1e-12;

const partDefaults = {
  source: { name: 'Light source', radius: 8, wavelength: 532, power: 1, divergence: 0.35, samples: 49 },
  mirror: { name: 'Plane mirror', radius: 30, reflectivity: 0.98 },
  lens: { name: 'Thin lens', radius: 26, focalLength: 110, transmission: 0.97 },
  aperture: { name: 'Aperture', radius: 25, opening: 10 },
  detector: { name: 'Area detector', width: 46, height: 46, columns: 32, rows: 32 },
  splitter: { name: 'Beam splitter', radius: 28, reflectivity: 0.5, transmission: 0.5 },
  filter: { name: 'Bandpass filter', radius: 25, centerWavelength: 532, bandwidth: 55, transmission: 0.9 },
  grating: { name: 'Diffraction grating', radius: 28, grooveDensity: 600, order: 1, reflective: false, transmission: 0.8 },
};

const add = ([x, y, z], [a, b, c]) => [x + a, y + b, z + c];
const subtract = ([x, y, z], [a, b, c]) => [x - a, y - b, z - c];
const scale = ([x, y, z], factor) => [x * factor, y * factor, z * factor];
const dot = ([x, y, z], [a, b, c]) => x * a + y * b + z * c;
const unit = (vector) => scale(vector, 1 / Math.hypot(...vector));
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function number(value, fallback, min, max) {
  return clamp(Number.isFinite(value) ? value : fallback, min, max);
}

function finitePoint(point, fallback) {
  return Array.isArray(point) && point.length === 3 && point.every(Number.isFinite) ? [...point] : [...fallback];
}

export function createPart(type, id, position = [0, 0, 70]) {
  if (!Object.hasOwn(partDefaults, type)) throw new RangeError('Unknown optical component: ' + type);
  return { id, type, ...partDefaults[type], position: finitePoint(position, [0, 0, 70]), rotation: [0, 0, 0], enabled: true };
}

export function createDefaultScene() {
  const source = createPart('source', 'source', [-210, 0, 70]);
  source.radius = 14;
  const lens = createPart('lens', 'lens', [-90, 0, 70]);
  lens.focalLength = 215;
  const mirror = createPart('mirror', 'mirror', [25, 0, 70]);
  mirror.rotation = [0, 0, -45];
  const detector = createPart('detector', 'detector', [25, 100, 70]);
  detector.rotation = [0, 0, 90];
  return { parts: [source, lens, mirror, detector] };
}

export function partAxes(part) {
  // Extrinsic rotations about the world X, Y and Z axes, in that order.
  const [rx, ry, rz] = finitePoint(part.rotation, [0, 0, 0]).map(angle => angle * DEGREES);
  const [sx, sy, sz] = [Math.sin(rx), Math.sin(ry), Math.sin(rz)];
  const [cx, cy, cz] = [Math.cos(rx), Math.cos(ry), Math.cos(rz)];
  return {
    normal: [cz * cy, sz * cy, -sy],
    u: [cz * sy * sx - sz * cx, sz * sy * sx + cz * cx, cy * sx],
    v: [cz * sy * cx + sz * sx, sz * sy * cx - cz * sx, cy * cx],
  };
}

function normalizePart(part) {
  const defaults = partDefaults[part.type];
  const rectangular = part.type === 'detector' || (Number.isFinite(part.width) && Number.isFinite(part.height));
  return {
    ...defaults,
    ...part,
    position: finitePoint(part.position, [0, 0, 70]),
    ...partAxes(part),
    radius: number(part.radius, defaults.radius ?? 25, 0.01, 1000),
    halfWidth: rectangular ? number(part.width, defaults.width ?? 50, 0.01, 2000) / 2 : null,
    halfHeight: rectangular ? number(part.height, defaults.height ?? 50, 0.01, 2000) / 2 : null,
  };
}

function spectrumFor(source) {
  const explicit = Array.isArray(source.spectrum) ? source.spectrum : [];
  const lines = explicit.filter(line => Number.isFinite(line?.wavelength) && line.wavelength > 0)
    .slice(0, 24)
    .map(line => ({
      wavelength: line.wavelength,
      weight: number(line.power, 1, 0, 1e9),
    }));
  if (lines.length) return lines;
  return [{ wavelength: number(source.wavelength, 532, 1, 1e7), weight: 1 }];
}

function beamSamples(count) {
  const samples = count % 2 ? [[0, 0]] : [];
  const pairs = Math.floor(count / 2);
  for (let index = 0; index < pairs; index += 1) {
    const radius = Math.sqrt((index + 0.5) / pairs);
    const angle = index * GOLDEN_ANGLE;
    const sample = [radius * Math.cos(angle), radius * Math.sin(angle)];
    samples.push(sample, [-sample[0], -sample[1]]);
  }
  return samples;
}

function startRays(sources) {
  const sourceLines = sources.map(source => ({ source, lines: spectrumFor(source).filter(line => line.weight > 0) }));
  const lineCount = sourceLines.reduce((total, entry) => total + entry.lines.length, 0);
  const sampleLimit = Math.max(1, Math.floor(MAX_INITIAL_RAYS / Math.max(1, lineCount)));
  const rays = [];
  for (const { source, lines } of sourceLines) {
    const power = number(source.power, 1, 0, 1e6);
    const weightSum = lines.reduce((total, line) => total + line.weight, 0);
    if (power <= MIN_POWER || !weightSum) continue;
    const count = Math.round(number(source.samples, 49, 1, Math.min(sampleLimit, 301)));
    const tangent = Math.tan(number(source.divergence, 0.35, 0, 70) * DEGREES);
    for (const [u, v] of beamSamples(count)) {
      const radial = add(scale(source.u, u), scale(source.v, v));
      const origin = add(source.position, scale(radial, source.radius));
      const direction = unit(add(source.normal, scale(radial, tangent)));
      for (const { wavelength, weight } of lines) {
        const rayPower = power * weight / (weightSum * count);
        rays.push({ sourceId: source.id, wavelength, power: rayPower, inputPower: rayPower, points: [origin], direction });
      }
    }
  }
  return rays;
}

function findIntersection(origin, direction, surfaces, distanceLimit) {
  let closest = null;
  let shortest = distanceLimit;
  for (const surface of surfaces) {
    const normalProjection = dot(direction, surface.normal);
    if (Math.abs(normalProjection) <= EPSILON) continue;
    const distance = dot(subtract(surface.position, origin), surface.normal) / normalProjection;
    if (distance <= EPSILON || distance >= shortest) continue;
    const point = add(origin, scale(direction, distance));
    const offset = subtract(point, surface.position);
    const u = dot(offset, surface.u);
    const v = dot(offset, surface.v);
    const outside = surface.halfWidth === null
      ? u * u + v * v > surface.radius * surface.radius + EPSILON
      : Math.abs(u) > surface.halfWidth + EPSILON || Math.abs(v) > surface.halfHeight + EPSILON;
    if (outside) continue;
    closest = { surface, point, u, v, normalProjection, distance };
    shortest = distance;
  }
  return closest;
}

function reflect(direction, normal, normalProjection) {
  return unit(subtract(direction, scale(normal, 2 * normalProjection)));
}

function lensDirection(direction, hit) {
  const { surface, normalProjection, u, v } = hit;
  const focalLength = number(surface.focalLength, 110, -5000, 5000);
  if (Math.abs(focalLength) <= EPSILON) return direction;
  const offset = add(scale(surface.u, u), scale(surface.v, v));
  // The transverse slope changes by -height/f in a thin lens.
  return unit(subtract(scale(direction, 1 / Math.abs(normalProjection)), scale(offset, 1 / focalLength)));
}

function gratingDirection(direction, wavelength, hit) {
  const { surface, normalProjection } = hit;
  const grooveDensity = number(surface.grooveDensity, 600, 0, 10000);
  const order = Math.round(number(surface.order, 1, -12, 12));
  const u = dot(direction, surface.u) + order * wavelength * grooveDensity / 1e6;
  const v = dot(direction, surface.v);
  const normalSquared = 1 - u * u - v * v;
  if (normalSquared <= EPSILON) return null;
  const sign = Math.sign(normalProjection) * (surface.reflective ? -1 : 1);
  return unit(add(add(scale(surface.u, u), scale(surface.v, v)), scale(surface.normal, sign * Math.sqrt(normalSquared))));
}

function insideOpening(hit) {
  const { surface, u, v } = hit;
  if (Number.isFinite(surface.openingWidth) && Number.isFinite(surface.openingHeight)) {
    return surface.openingWidth > 0 && surface.openingHeight > 0
      && Math.abs(u) <= surface.openingWidth / 2 && Math.abs(v) <= surface.openingHeight / 2;
  }
  const radius = number(surface.opening, 10, 0, 2000) / 2;
  return radius > 0 && u * u + v * v <= radius * radius;
}

function createDetector(surface, wavelengths) {
  const columns = Math.round(number(surface.columns, 32, 1, 128));
  const rows = Math.round(number(surface.rows, 32, 1, 128));
  return {
    id: surface.id,
    name: surface.name,
    width: surface.halfWidth * 2,
    height: surface.halfHeight * 2,
    power: 0,
    count: 0,
    centroid: null,
    hits: [],
    spectrum: new Map(wavelengths.map(wavelength => [wavelength, 0])),
    bins: { columns, rows, values: Array(columns * rows).fill(0) },
  };
}

function recordDetection(detector, ray, hit, power) {
  const { columns, rows, values } = detector.bins;
  const { u, v } = hit;
  const column = clamp(Math.floor((0.5 + u / detector.width) * columns), 0, columns - 1);
  const row = clamp(Math.floor((0.5 - v / detector.height) * rows), 0, rows - 1);
  values[row * columns + column] += power;
  detector.count += 1;
  detector.power += power;
  detector.spectrum.set(ray.wavelength, (detector.spectrum.get(ray.wavelength) ?? 0) + power);
  detector.hits.push({ u, v, wavelength: ray.wavelength, power, column, row });
}

function finalizeDetector(detector) {
  const moments = detector.hits.reduce(([x, y], hit) => [x + hit.u * hit.power, y + hit.v * hit.power], [0, 0]);
  detector.centroid = detector.power ? moments.map(value => value / detector.power) : null;
  detector.spectrum = Array.from(detector.spectrum, ([wavelength, power]) => ({ wavelength, power }));
  return detector;
}

function summarizeRay(ray, points, power, pathLength, interactions, reason, detectorId) {
  const { sourceId, wavelength, inputPower } = ray;
  return { sourceId, wavelength, inputPower, power, pathLength, interactions, reason, points, detectorId };
}

export function traceScene(scene) {
  const parts = [];
  const ids = new Set();
  for (const part of Array.isArray(scene?.parts) ? scene.parts : []) {
    if (!part || !Object.hasOwn(partDefaults, part.type) || typeof part.id !== 'string' || ids.has(part.id)) continue;
    ids.add(part.id);
    parts.push(normalizePart(part));
  }
  const sources = parts.filter(part => part.type === 'source' && part.enabled !== false);
  const surfaces = parts.filter(part => part.type !== 'source' && part.enabled !== false);
  const queue = startRays(sources);
  const wavelengths = [...new Set(queue.map(ray => ray.wavelength))].sort((a, b) => a - b);
  const detectors = new Map(parts.filter(part => part.type === 'detector').map(part => [part.id, createDetector(part, wavelengths)]));
  const emittedPower = queue.reduce((total, ray) => total + ray.power, 0);
  const maxInteractions = Math.round(number(scene?.maxInteractions, 20, 1, 80));
  const maxDistance = number(scene?.maxDistance, 2200, 1, 10000);
  const escapeLength = number(scene?.escapeLength, 260, 1, 2000);
  const rays = [];
  let unresolvedPower = 0;

  while (queue.length) {
    const ray = queue.pop();
    const points = [...ray.points];
    const interactions = [...(ray.interactions ?? [])];
    let direction = ray.direction;
    let power = ray.power;
    let distance = ray.distance ?? 0;
    let reason = 'limit';
    let detectorId = null;
    while (interactions.length < maxInteractions && power > MIN_POWER && distance < maxDistance) {
      const origin = points[points.length - 1];
      const groundDistance = direction[2] < -EPSILON && origin[2] >= 0 ? -origin[2] / direction[2] : Infinity;
      const limit = Math.min(maxDistance - distance, groundDistance);
      const hit = findIntersection(origin, direction, surfaces, limit);
      if (!hit) {
        const finalSegment = Math.min(escapeLength, limit);
        if (finalSegment > EPSILON) points.push(add(origin, scale(direction, finalSegment)));
        reason = groundDistance <= escapeLength && groundDistance <= maxDistance - distance ? 'table' : 'escaped';
        distance += finalSegment;
        break;
      }
      points.push(hit.point);
      distance += hit.distance;
      const { surface, normalProjection } = hit;
      interactions.push({
        partId: surface.id,
        point: hit.point,
        segmentLength: hit.distance,
        pathLength: distance,
        inputPower: power,
      });
      switch (surface.type) {
        case 'detector':
          recordDetection(detectors.get(surface.id), ray, hit, power);
          detectorId = surface.id;
          reason = 'detected';
          break;
        case 'mirror':
          direction = reflect(direction, surface.normal, normalProjection);
          power *= number(surface.reflectivity, 0.98, 0, 1);
          break;
        case 'lens':
          direction = lensDirection(direction, hit);
          power *= number(surface.transmission, 0.97, 0, 1);
          break;
        case 'aperture':
          if (!insideOpening(hit)) {
            power = 0;
            reason = 'aperture';
          }
          break;
        case 'filter': {
          const center = number(surface.centerWavelength, 532, 1, 1e7);
          const width = number(surface.bandwidth, 55, 0.001, 1e7);
          const bandpass = Math.exp(-4 * Math.LN2 * ((ray.wavelength - center) / width) ** 2);
          power *= bandpass * number(surface.transmission, 0.9, 0, 1);
          break;
        }
        case 'grating': {
          const diffracted = gratingDirection(direction, ray.wavelength, hit);
          if (!diffracted) {
            power = 0;
            reason = 'evanescent';
            break;
          }
          direction = diffracted;
          power *= number(surface.transmission, 0.8, 0, 1);
          break;
        }
        case 'splitter': {
          const reflection = number(surface.reflectivity, 0.5, 0, 1);
          const transmission = number(surface.transmission, 0.5, 0, 1);
          const fraction = Math.max(1, reflection + transmission);
          const reflectedPower = power * reflection / fraction;
          power *= transmission / fraction;
          if (reflectedPower > MIN_POWER) {
            if (rays.length + queue.length + 1 < MAX_PATHS) {
              queue.push({
                ...ray,
                points: [...points],
                direction: reflect(direction, surface.normal, normalProjection),
                power: reflectedPower,
                distance,
                interactions: [...interactions],
              });
            } else {
              unresolvedPower += reflectedPower;
            }
          }
          break;
        }
        default:
          break;
      }
      if (reason !== 'limit') break;
      if (power <= MIN_POWER) {
        reason = 'absorption';
        power = 0;
      }
    }
    if (reason === 'limit') unresolvedPower += power;
    rays.push(summarizeRay(ray, points, power, distance, interactions, reason, detectorId));
  }
  const readings = Array.from(detectors.values(), finalizeDetector);
  const detectedPower = readings.reduce((total, detector) => total + detector.power, 0);
  return { rays, detectors: readings, emittedPower, detectedPower, unresolvedPower };
}
