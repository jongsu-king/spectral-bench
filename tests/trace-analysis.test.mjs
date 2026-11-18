import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeTrace, analysisQuantities } from '../dist/app/trace-analysis.js';

const near = (actual, expected, tolerance = 1e-12) => assert.ok(Math.abs(actual - expected) <= tolerance,
  `Expected ${expected}, received ${actual}`);

test('triangle area, positive centroid, and raw sample SD match analytical values', () => {
  const result = analyzeTrace({ x: [0, 1, 2], y: [0, 2, 0] });
  assert.equal(result.statistics.count, 3);
  near(result.statistics.mean, 2 / 3);
  near(result.statistics.sampleSD, 2 / Math.sqrt(3));
  near(result.statistics.rms, 2 / Math.sqrt(3));
  assert.deepEqual(result.statistics.maximum, { x: 1, y: 2 });
  assert.deepEqual(result.statistics.minimum, { x: 0, y: 0 });
  near(result.integral.net, 2);
  near(result.integral.positive, 2);
  near(result.integral.negative, 0);
  near(result.integral.positiveCentroid, 1);
  near(result.coverage, 1);
});

test('sign-changing segments split at their interpolated zero crossing', () => {
  const result = analyzeTrace({ x: [0, 2], y: [-2, 2] });
  near(result.integral.net, 0);
  near(result.integral.positive, 1);
  near(result.integral.negative, -1);
  near(result.integral.absolute, 2);
  near(result.integral.positiveCentroid, 5 / 3);
  const reversedSign = analyzeTrace({ x: [0, 2], y: [2, -2] });
  near(reversedSign.integral.positiveCentroid, 1 / 3);
});

test('range edges interpolate without inventing raw observations or extrapolating', () => {
  const result = analyzeTrace({ x: [0, 2], y: [2, 6] }, { min: 0.5, max: 1.5 });
  assert.deepEqual(result.range, [0.5, 1.5]);
  assert.equal(result.statistics.count, 0);
  assert.equal(result.statistics.mean, null);
  assert.equal(result.statistics.sampleSD, null);
  assert.deepEqual(result.corrected, { x: [0.5, 1.5], y: [3, 5], interpolated: [true, true] });
  near(result.integral.net, 4);
  near(result.integral.positiveCentroid, 25 / 24);
  assert.match(result.warnings.join(' '), /No original observations/);
  const clipped = analyzeTrace({ x: [0, 2], y: [2, 6] }, { min: -10, max: 10 });
  assert.deepEqual(clipped.range, [0, 2]);
  near(clipped.integral.net, 8);
  assert.match(clipped.warnings.join(' '), /clipped/);
});

test('constant and endpoint baselines change only integration, preserving raw statistics', () => {
  const trace = { x: [0, 1, 2, 3, 4], y: [2, 5, 8, 7, 6] };
  const raw = analyzeTrace(trace);
  const line = analyzeTrace(trace, { baseline: 'linear' });
  assert.deepEqual(line.statistics, raw.statistics);
  assert.deepEqual(line.baselineCurve, { x: [0, 4], y: [2, 6] });
  assert.deepEqual(line.corrected.y, [0, 2, 4, 2, 0]);
  near(line.integral.net, 8);
  near(line.integral.positiveCentroid, 2);
  const constant = analyzeTrace({ x: [0, 2], y: [0, 2] }, { baseline: 'constant', baselineValue: 1 });
  near(constant.integral.net, 0);
  near(constant.integral.positive, 0.5);
  near(constant.integral.negative, -0.5);
  near(constant.integral.positiveCentroid, 5 / 3);
});

test('missing X or Y splits runs and reduces covered width, never bridging the gap', () => {
  for (const trace of [
    { x: [0, 1, 2, 3, 4], y: [1, 1, null, 1, 1] },
    { x: [0, 1, NaN, 3, 4], y: [1, 1, 1, 1, 1] },
  ]) {
    const result = analyzeTrace(trace);
    near(result.integral.net, 2);
    near(result.coveredWidth, 2);
    near(result.coverage, 0.5);
    assert.equal(result.segments, 2);
    assert.equal(result.statistics.count, 4);
    assert.deepEqual(result.corrected.x, [0, 1, null, 3, 4]);
    assert.match(result.warnings.join(' '), /Missing intervals/);
  }
  const isolated = analyzeTrace({ x: [0, 1, 2], y: [1, null, 3] });
  assert.equal(isolated.integral.net, null);
  assert.equal(isolated.integral.positive, null);
  assert.equal(isolated.integral.positiveCentroid, null);
  assert.equal(isolated.coveredWidth, 0);
  assert.equal(isolated.statistics.count, 2);
});

test('descending axes yield the same result and inputs remain unchanged', () => {
  const x = Object.freeze([4, 3, 2, 1, 0]), y = Object.freeze([6, 7, 8, 5, 2]);
  const input = Object.freeze({ x, y });
  const descending = analyzeTrace(input, { baseline: 'linear', min: 0.5, max: 3.5 });
  const ascending = analyzeTrace({ x: [...x].reverse(), y: [...y].reverse() }, { baseline: 'linear', min: 0.5, max: 3.5 });
  assert.deepEqual(descending, ascending);
  assert.deepEqual(input, { x: [4, 3, 2, 1, 0], y: [6, 7, 8, 5, 2] });
});

test('ambiguous axes and invalid ranges or baselines are rejected explicitly', () => {
  assert.throws(() => analyzeTrace({ x: [0, 1, 1, 2], y: [1, 1, 2, 2] }), /distinct X/);
  assert.throws(() => analyzeTrace({ x: [0, 2, 1], y: [1, 2, 3] }), /monotonic/);
  assert.throws(() => analyzeTrace({ x: [0, 1], y: [1] }), /matching X and Y/);
  assert.throws(() => analyzeTrace({ x: [0, 1], y: [1, null] }), /at least two/);
  for (const options of [{ min: 2, max: 1 }, { min: 1, max: 1 }, { max: NaN }, { min: 3, max: 4 }]) {
    assert.throws(() => analyzeTrace({ x: [0, 2], y: [0, 1] }, options), /range/);
  }
  assert.throws(() => analyzeTrace({ x: [0, 2], y: [0, 1] }, { baseline: 'constant' }), /finite constant baseline/);
  assert.throws(() => analyzeTrace({ x: [0, 2], y: [0, 1] }, { baseline: 'cubic' }), /Choose no baseline/);
  assert.throws(() => analyzeTrace({ x: [0, 1, 2, 3], y: [0, null, null, 1] },
    { baseline: 'linear', min: 0.5 }), /finite values at both range boundaries/);
});

test('no positive signal yields no positive-area centroid and metadata states units and method', () => {
  const result = analyzeTrace({ x: [0, 1, 2], y: [-2, -2, -2] });
  assert.equal(result.integral.positiveCentroid, null);
  near(result.integral.net, -4);
  const quantities = new Map(analysisQuantities({ result, xLabel: 'Wavelength (nm)', yLabel: 'Absorbance (AU)' })
    .map(([key, value, unit]) => [key, { value, unit }]));
  assert.equal(quantities.get('net_area').unit, 'AU·nm');
  assert.match(quantities.get('integration_method').value, /no extrapolation or missing-interval bridging/);
  assert.match(quantities.get('statistics_method').value, /Original finite observations only/);
});

test('unrepresentable numeric spans are rejected rather than returning an incorrect interpolated area', () => {
  assert.throws(() => analyzeTrace({ x: [-1e308, 1e308], y: [0, 1] }, { min: 0, max: 1 }), /numeric X span/);
  assert.throws(() => analyzeTrace({ x: [0, 1], y: [-1e308, 1e308] }), /numeric span/);
});
