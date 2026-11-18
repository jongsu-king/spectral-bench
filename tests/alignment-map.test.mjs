import test from 'node:test';
import assert from 'node:assert/strict';
import { alignmentMapGrid, alignmentMapReadings, bestAlignmentMapPoint, alignmentMapSurface, alignmentMapCsv } from '../dist/app/alignment-map.js';
import { createInstrumentScene, traceInstrumentOptics } from '../dist/app/instrument-optics.js';
import { opticalModels } from '../dist/app/models-optical.js';
import { advancedModels } from '../dist/app/models-advanced.js';

const optic = { id: 'lens', position: [10, 20, 30], rotation: [0, 5, 10] };
const settings = [{ key: 'x', min: -10, max: 10, steps: 3 }, { key: 'rz', min: -5, max: 5, steps: 5 }];

test('alignment grids include both bounds and baseline offsets without modifying the optic', () => {
  const saved = structuredClone(optic);
  const [first, second] = alignmentMapGrid(optic, settings);
  assert.deepEqual(first.values, [-10, 0, 10]);
  assert.deepEqual(second.values, [-5, -2.5, 0, 2.5, 5]);
  assert.equal(first.origin, 10); assert.equal(second.origin, 10);
  assert.equal(first.unit, 'mm'); assert.equal(second.unit, '°');
  assert.deepEqual(optic, saved);
  for (const invalid of [
    [{ ...settings[0], key: 'rz' }, settings[1]], [{ ...settings[0], steps: 16 }, settings[1]],
    [{ ...settings[0], steps: 2 }, settings[1]], [{ ...settings[0], min: NaN }, settings[1]],
    [{ ...settings[0], min: 10 }, settings[1]], [{ ...settings[0], max: 1501 }, settings[1]],
    [null, settings[1]],
  ]) assert.throws(() => alignmentMapGrid(optic, invalid));
  assert.throws(() => alignmentMapGrid({ ...optic, position: [2499, 20, 30] }, settings), /final positions/);
  assert.throws(() => alignmentMapGrid({ ...optic, rotation: [0, 5, 359] }, settings), /rotations/);
});

test('alignment readings use power-weighted RMS and leave unavailable spot radii missing', () => {
  const traced = { coupling: .8, detectors: [{ id: 'sensor', power: 4, count: 2, centroid: [1.5, 0],
    hits: [{ u: 0, v: 0, power: 1 }, { u: 2, v: 0, power: 3 }] }] };
  const actual = alignmentMapReadings(traced, 'sensor');
  assert.equal(actual.transfer, 80); assert.equal(actual.count, 2); assert.equal(actual.power, 4);
  assert(Math.abs(actual.rms - Math.sqrt(.75)) < 1e-12);
  const empty = alignmentMapReadings({ coupling: 0, detectors: [{ id: 'sensor', power: 0, count: 0, centroid: null, hits: [] }] }, 'sensor');
  assert.equal(empty.power, 0); assert(Number.isNaN(empty.rms));
  const missing = alignmentMapReadings(traced, 'missing'); assert(Number.isNaN(missing.power)); assert(Number.isNaN(missing.count));
});

test('sample candidate selection masks missing results and RMS without detected power', () => {
  const rows = [{ xOffset: -10, yOffset: 0, power: 2, count: 3, rms: 2 },
    { xOffset: 0, yOffset: 0, power: 2, count: 3, rms: 1 },
    { xOffset: 10, yOffset: 0, power: 0, count: 0, rms: 0 },
    { xOffset: 0, yOffset: 10, power: NaN, count: NaN, rms: NaN }];
  assert.equal(bestAlignmentMapPoint(rows, 'power'), 1);
  assert.equal(bestAlignmentMapPoint(rows, 'rms'), 1);
  assert.equal(bestAlignmentMapPoint([{ power: 0, count: 0, rms: NaN }], 'rms'), -1);
  assert.equal(bestAlignmentMapPoint([], 'power'), -1);
  assert.equal(bestAlignmentMapPoint(rows, 'missing'), -1);
});

test('map surfaces retain row/column orientation and CSV records the original absolute pose', () => {
  const axes = alignmentMapGrid(optic, settings.map(setting => ({ ...setting, steps: 3 })));
  const rows = axes[1].values.flatMap((yOffset, row) => axes[0].values.map((xOffset, column) =>
    ({ xOffset, yOffset, power: 10 * row + column, transfer: 50, count: 3, rms: row === 2 ? NaN : .5 })));
  const result = { axes, rows, station: 'uv', mode: 'sample', partId: 'lens', partName: 'Lens, "A"',
    detectorId: 'detector', detectorName: 'Detector', origin: structuredClone(optic) };
  const surface = alignmentMapSurface(result, 'power');
  assert.deepEqual(surface.z, [[0, 1, 2], [10, 11, 12], [20, 21, 22]]);
  assert.deepEqual(surface.x, [-10, 0, 10]); assert.deepEqual(surface.y, [-5, 0, 5]);
  assert.equal(surface.xLabel, 'X offset (mm)'); assert.equal(surface.yLabel, 'Rz offset (°)');
  assert.equal(surface.zLabel, 'Detector power (mW)');
  assert.deepEqual(alignmentMapSurface(result, 'rms').z[2], [null, null, null]);
  const csv = alignmentMapCsv(result); const lines = csv.replace(/^\uFEFF/, '').split('\r\n');
  assert.equal(lines.length, 10); assert.match(lines[0], /origin_x_mm.*origin_rz_deg/);
  assert.match(lines[1], /"Lens, ""A"""/); assert.match(lines[1], /"10","20","30","0","5","10"/);
  assert(!csv.includes('NaN'));
});

test('two-coordinate detector maps retrace all nine instruments and leave the live scene unchanged', () => {
  const models = { ...opticalModels, ...advancedModels };
  for (const [id, model] of Object.entries(models)) {
    const settings = Object.fromEntries(model.controls.map(control => [control.key, control.value]));
    const original = createInstrumentScene(id, settings), saved = structuredClone(original);
    const detectorId = id === 'thz' ? 'receiver' : 'detector';
    const optic = original.parts.find(part => part.id === detectorId);
    const axes = alignmentMapGrid(optic, [{ key: 'y', min: -80, max: 80, steps: 3 }, { key: 'z', min: -80, max: 80, steps: 3 }]);
    const rows = [];
    for (const yOffset of axes[1].values) for (const xOffset of axes[0].values) {
      const candidate = structuredClone(original); const detector = candidate.parts.find(part => part.id === detectorId);
      detector.position[1] += xOffset; detector.position[2] += yOffset;
      rows.push({ xOffset, yOffset, ...alignmentMapReadings(traceInstrumentOptics(id, settings, candidate), detectorId) });
    }
    assert.deepEqual(original, saved, id + ' live layout');
    assert(rows.every(row => Number.isFinite(row.power)), id + ' finite detector power');
    assert.equal(bestAlignmentMapPoint(rows, 'power'), 4, id + ' centered detector');
    assert(rows.some(row => row.power === 0), id + ' off-axis blocking');
  }
});
