import { createPart } from './optics3d.js';

export const partNames = {
  lens: 'Thin lens', mirror: 'Plane mirror', aperture: 'Aperture', splitter: 'Beam splitter',
  filter: 'Bandpass filter', grating: 'Diffraction grating', detector: 'Area detector', source: 'Light source',
};

const radius = ['radius', 'Clear radius (mm)', 0.1, 200, 0.5];
const transmission = ['transmission', 'Transmission', 0, 1, 0.01];
const reflectivity = ['reflectivity', 'Reflectivity', 0, 1, 0.01];
export const partProperties = {
  lens: [radius, ['focalLength', 'Focal length (mm)', -3000, 3000, 1], transmission],
  mirror: [radius, reflectivity],
  aperture: [radius, ['opening', 'Opening (mm)', 0, 400, 0.5]],
  splitter: [radius, reflectivity, transmission],
  filter: [radius, ['centerWavelength', 'Center (nm)', 100, 1e7, 1], ['bandwidth', 'FWHM (nm)', 0.1, 1e7, 1], transmission],
  grating: [radius, ['grooveDensity', 'Grooves / mm', 1, 3000, 1], ['order', 'Diffraction order', -4, 4, 1], transmission],
  detector: [['width', 'Width (mm)', 0.1, 400, 0.5], ['height', 'Height (mm)', 0.1, 400, 0.5]],
  source: [
    ['radius', 'Beam radius (mm)', 0.001, 200, 0.5], ['power', 'Power (mW)', 0, 10000, 0.01],
    ['divergence', 'Half-angle (°)', 0, 60, 0.1], ['samples', 'Samples per line', 1, 301, 1],
  ],
};

const axes = ['position', 'rotation'];
const vector = value => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);
const bounded = (value, min, max) => Math.min(max, Math.max(min, value));
const idValid = id => typeof id === 'string' && /^[\w-]{1,80}$/.test(id);
const mutableNumbers = new Map(Object.values(partProperties).flat().map(([key, , min, max]) => [key, [min, max]]));

export function emptyEdits() {
  return { offsets: {}, properties: {}, removed: [], added: [] };
}

export function hasEdits(edits) {
  return Boolean(edits?.added?.length || edits?.removed?.length || Object.keys(edits?.offsets ?? {}).length ||
    Object.keys(edits?.properties ?? {}).length);
}

function validProperties(input) {
  const result = {};
  if (!input || typeof input !== 'object') return result;
  for (const [key, value] of Object.entries(input)) {
    if (mutableNumbers.has(key) && Number.isFinite(value)) {
      result[key] = bounded(value, ...mutableNumbers.get(key));
    } else if ((key === 'enabled' || key === 'reflective') && typeof value === 'boolean') {
      result[key] = value;
    }
  }
  return result;
}

export function restoreEdits(saved) {
  const result = emptyEdits();
  for (const [id, transform] of Object.entries(saved?.offsets ?? {}).slice(0, 64)) {
    if (!idValid(id)) continue;
    const value = {};
    for (const axis of axes) {
      if (vector(transform?.[axis])) value[axis] = transform[axis].map(item => bounded(item, -5000, 5000));
    }
    if (Object.keys(value).length) Object.defineProperty(result.offsets, id, { value, enumerable: true, configurable: true, writable: true });
  }
  for (const [id, properties] of Object.entries(saved?.properties ?? {}).slice(0, 64)) {
    if (!idValid(id)) continue;
    Object.defineProperty(result.properties, id, { value: validProperties(properties), enumerable: true, configurable: true, writable: true });
  }
  if (Array.isArray(saved?.removed)) result.removed = [...new Set(saved.removed.filter(idValid))].slice(0, 64);
  if (!Array.isArray(saved?.added)) return result;
  const ids = new Set();
  for (const part of saved.added.slice(0, 36)) {
    if (!idValid(part?.id) || ids.has(part.id) || !Object.hasOwn(partNames, part.type)) continue;
    ids.add(part.id);
    const position = vector(part.position) ? part.position.map(item => bounded(item, -2500, 2500)) : undefined;
    const rotation = vector(part.rotation) ? part.rotation.map(item => bounded(item, -360, 360)) : [0, 0, 0];
    result.added.push({ ...createPart(part.type, part.id, position), ...validProperties(part), rotation,
      name: typeof part.name === 'string' && part.name.trim() ? part.name.slice(0, 60) : partNames[part.type] });
  }
  return result;
}

export function editedScene(nominal, edits) {
  const removed = new Set(edits.removed);
  const ids = new Set(nominal.parts.map(part => part.id));
  const parts = nominal.parts.filter(part => !removed.has(part.id)).map(part => {
    const offset = Object.hasOwn(edits.offsets, part.id) ? edits.offsets[part.id] : {};
    const properties = Object.hasOwn(edits.properties, part.id) ? edits.properties[part.id] : {};
    return {
      ...part, ...properties,
      position: part.position.map((value, index) => value + (offset.position?.[index] ?? 0)),
      rotation: part.rotation.map((value, index) => value + (offset.rotation?.[index] ?? 0)),
    };
  });
  return { ...nominal, parts: [...parts, ...edits.added.filter(part => !ids.has(part.id))] };
}

export function changePose(edits, nominal, id, axis, next) {
  if (!axes.includes(axis) || !vector(next)) return false;
  const added = edits.added.find(part => part.id === id);
  if (added) {
    added[axis] = [...next];
    return true;
  }
  const base = nominal.parts.find(part => part.id === id);
  if (!base) return false;
  const prior = Object.hasOwn(edits.offsets, id) ? { ...edits.offsets[id] } : {};
  const delta = next.map((value, index) => value - base[axis][index]);
  if (delta.some(value => Math.abs(value) > 1e-8)) prior[axis] = delta;
  else delete prior[axis];
  if (Object.keys(prior).length) edits.offsets[id] = prior;
  else delete edits.offsets[id];
  return true;
}

export function changeProperty(edits, id, key, value) {
  const properties = validProperties({ [key]: value });
  if (!Object.hasOwn(properties, key)) return;
  const added = edits.added.find(part => part.id === id);
  if (added) Object.assign(added, properties);
  else edits.properties[id] = { ...(Object.hasOwn(edits.properties, id) ? edits.properties[id] : {}), ...properties };
}

export function removePart(edits, scene, id) {
  const index = edits.added.findIndex(part => part.id === id);
  if (index !== -1) { edits.added.splice(index, 1); return; }
  const connected = [id, id + '-beam', ...(scene.id === 'raman' && id === 'sample' ? ['scattering'] : [])];
  for (const target of connected) {
    if (scene.parts.some(part => part.id === target) && !edits.removed.includes(target)) edits.removed.push(target);
  }
}

function placement(scene, trace, selectedId, type) {
  const target = scene.parts.find(part => part.id === selectedId);
  const eligible = (trace?.rays ?? []).filter(ray => ray.detectorId && ray.points.length > 1);
  const ray = eligible.find(path => path.interactions?.some(hit => hit.partId === selectedId)) ?? eligible[0];
  if (ray) {
    const index = ray.interactions?.findIndex(hit => hit.partId === selectedId) ?? -1;
    const [a, b] = index >= 0 ? [ray.points[index], ray.points[index + 1]] : ray.points.slice(-2);
    if (a && b) {
      const d = b.map((value, axis) => value - a[axis]);
      const length = Math.hypot(...d);
      if (length > 0.1) {
        const midpoint = a.map((value, axis) => (value + b[axis]) / 2);
        const yaw = Math.atan2(d[1], d[0]) * 180 / Math.PI;
        const pitch = -Math.asin(d[2] / length) * 180 / Math.PI;
        return { position: midpoint, rotation: [0, pitch, yaw + (type === 'mirror' ? -45 : 0)] };
      }
    }
  }
  return {
    position: target ? [target.position[0] + 45, target.position[1], target.position[2]] : [0, 0, 72],
    rotation: [0, 0, type === 'mirror' ? -45 : 0],
  };
}

export function newOptic(scene, trace, type, selectedId) {
  if (!Object.hasOwn(partNames, type)) return null;
  const ids = new Set(scene.parts.map(part => part.id));
  let serial = 1;
  while (ids.has('insert-' + serial)) serial++;
  const { position, rotation } = placement(scene, trace, selectedId, type);
  const part = createPart(type, 'insert-' + serial, position);
  return { ...part, name: partNames[type] + ' ' + serial, rotation };
}
