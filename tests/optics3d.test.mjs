import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultScene, createPart, partAxes, traceScene } from '../dist/app/optics3d.js';

function optic(type, id, position, settings = {}) {
  return { ...createPart(type, id, position), ...settings };
}

function near(value, expected, tolerance = 1e-8) {
  assert.ok(Math.abs(value - expected) <= tolerance, 'Expected ' + expected + ', got ' + value);
}

test('the default bench measures the folded path through a lens and mirror', () => {
  const traced = traceScene(createDefaultScene());
  const [detector] = traced.detectors;
  assert.equal(detector.count, 49);
  near(detector.power, 0.97 * 0.98);
  near(detector.bins.values.reduce((sum, value) => sum + value, 0), detector.power);
  const ray = traced.rays.find(candidate => candidate.points[0][1] === 0 && candidate.points[0][2] === 70);
  assert.deepEqual(ray.interactions.map(hit => hit.partId), ['lens', 'mirror', 'detector']);
  near(ray.pathLength, 335);
  near(ray.interactions[1].segmentLength, 115);
});

test('out-of-plane mirror tilt directs a ray upward to the detector', () => {
  const source = optic('source', 'source', [-80, 0, 40], { samples: 1, divergence: 0 });
  const mirror = optic('mirror', 'mirror', [0, 0, 40], { rotation: [0, 45, 0], reflectivity: 1 });
  const detector = optic('detector', 'detector', [0, 0, 140], { rotation: [0, -90, 0] });
  const scene = { parts: [detector, mirror, source] };
  const trace = traceScene(scene);
  near(partAxes(detector).normal[2], 1);
  assert.equal(trace.rays[0].detectorId, 'detector');
  near(trace.rays[0].points[2][0], 0);
  near(trace.rays[0].points[2][2], 140);
  near(trace.rays[0].pathLength, 180);
  near(trace.detectors[0].power, 1);

  const shifted = { ...detector, position: [30, 0, 140] };
  const miss = traceScene({ parts: [shifted, mirror, source] });
  assert.equal(miss.detectors[0].count, 0);
  assert.equal(miss.rays[0].reason, 'escaped');
});

test('an inserted thin lens focuses the bundle and increasing samples retains total power', () => {
  const source = optic('source', 'source', [0, 0, 70], { radius: 20, samples: 301, divergence: 0 });
  const detector = optic('detector', 'detector', [200, 0, 70], { width: 6, height: 6 });
  const lens = optic('lens', 'lens', [100, 0, 70], { radius: 25, focalLength: 100, transmission: 1 });
  const uncorrected = traceScene({ parts: [source, detector] });
  const focused = traceScene({ parts: [source, detector, lens] });
  assert.ok(uncorrected.detectedPower < 0.1);
  assert.equal(focused.rays.length, 301);
  assert.equal(focused.detectors[0].count, 301);
  near(focused.detectedPower, 1);
  near(Math.max(...focused.detectors[0].hits.map(hit => Math.hypot(hit.u, hit.v))), 0);
});

test('a stopped-down finite aperture clips the bundle before it reaches the detector', () => {
  const source = optic('source', 'source', [0, 0, 70], { radius: 15, samples: 101, divergence: 0 });
  const aperture = optic('aperture', 'iris', [40, 0, 70], { opening: 10 });
  const detector = optic('detector', 'detector', [80, 0, 70]);
  const trace = traceScene({ parts: [detector, source, aperture] });
  assert.ok(trace.detectedPower > 0 && trace.detectedPower < 0.2);
  const blocked = trace.rays.find(ray => ray.reason === 'aperture');
  assert.ok(blocked);
  assert.equal(blocked.interactions[0].partId, 'iris');
  near(blocked.pathLength, 40);
});

test('a transmission grating sends two wavelengths to the expected detector coordinates', () => {
  const source = optic('source', 'source', [0, 0, 70], {
    samples: 1, spectrum: [{ wavelength: 450, power: 1 }, { wavelength: 650, power: 3 }],
  });
  const grating = optic('grating', 'grating', [50, 0, 70], { grooveDensity: 600, transmission: 1 });
  const detector = optic('detector', 'detector', [150, 40, 70], { width: 160 });
  const trace = traceScene({ parts: [source, detector, grating] });
  const [reading] = trace.detectors;
  assert.deepEqual(reading.spectrum, [{ wavelength: 450, power: 0.25 }, { wavelength: 650, power: 0.75 }]);
  for (const hit of reading.hits) {
    const sine = hit.wavelength * 600 / 1e6;
    near(hit.u, 100 * sine / Math.sqrt(1 - sine ** 2) - 40);
    near(hit.v, 0);
  }
  assert.notEqual(reading.hits[0].column, reading.hits[1].column);
});

test('a beam splitter conserves power across transmitted and reflected detectors', () => {
  const source = optic('source', 'source', [-40, 0, 70], { samples: 1 });
  const splitter = optic('splitter', 'splitter', [0, 0, 70], { rotation: [0, 0, -45], transmission: 1, reflectivity: 1 });
  const transmitted = optic('detector', 'transmitted', [70, 0, 70]);
  const reflected = optic('detector', 'reflected', [0, 60, 70], { rotation: [0, 0, 90] });
  const trace = traceScene({ parts: [source, splitter, transmitted, reflected] });
  assert.equal(trace.rays.length, 2);
  assert.equal(trace.unresolvedPower, 0);
  for (const detector of trace.detectors) near(detector.power, 0.5);
  near(trace.detectedPower, trace.emittedPower);
});

const plus = (first, second) => first.map((value, index) => value + second[index]);
const times = (values, scale) => values.map(value => value * scale);
const scalar = (first, second) => first.reduce((sum, value, index) => sum + value * second[index], 0);
const directionRotation = ([x, y, z]) => [0, -Math.asin(z) * 180 / Math.PI, Math.atan2(y, x) * 180 / Math.PI];

test('rotated component axes stay orthonormal and mirror rays obey vector reflection', () => {
  const rotations = [[0, 0, 0], [23, -31, 47], [-68, 42, -135], [90, 89.9, 270], [32, -90, 47]];
  for (const rotation of rotations) {
    const axes = partAxes({ rotation });
    const vectors = Object.values(axes);
    vectors.forEach(vector => near(Math.hypot(...vector), 1));
    for (let index = 0; index < 3; index += 1) {
      near(scalar(vectors[index], vectors[(index + 1) % 3]), 0);
    }
    const incoming = partAxes({ rotation: [0, -12, 8] }).normal;
    const origin = [0, 0, 1000];
    const center = plus(origin, times(incoming, 100));
    const normalComponent = scalar(incoming, axes.normal);
    const outgoing = plus(incoming, times(axes.normal, -2 * normalComponent));
    const source = optic('source', 'source', origin, { rotation: [0, -12, 8], samples: 1, divergence: 0 });
    const mirror = optic('mirror', 'mirror', center, { rotation, reflectivity: 0.73 });
    const detector = optic('detector', 'detector', plus(center, times(outgoing, 100)), {
      rotation: directionRotation(outgoing), width: 4, height: 4,
    });
    const trace = traceScene({ parts: [source, mirror, detector] });
    assert.equal(trace.detectors[0].count, 1, String(rotation));
    near(trace.detectedPower, 0.73);
    near(trace.rays[0].pathLength, 200);
    near(trace.detectors[0].hits[0].u, 0);
    near(trace.detectors[0].hits[0].v, 0);
  }
});

test('a tilted thin lens focuses collimated bundles from either side with the same focal distance', () => {
  const rotation = [23, -31, 47];
  const normal = partAxes({ rotation }).normal;
  const center = [0, 0, 1000];
  for (const side of [-1, 1]) {
    const forward = times(normal, side);
    const source = optic('source', 'source', plus(center, times(forward, -100)), {
      rotation: directionRotation(forward), radius: 10, samples: 101, divergence: 0,
    });
    const lens = optic('lens', 'lens', center, { rotation, focalLength: 120, transmission: 0.91 });
    const detector = optic('detector', 'detector', plus(center, times(forward, 120)), {
      rotation: directionRotation(forward), width: 1, height: 1,
    });
    const result = traceScene({ parts: [source, detector, lens] });
    assert.equal(result.detectors[0].count, 101);
    near(result.detectedPower, 0.91);
    near(Math.max(...result.detectors[0].hits.map(hit => Math.hypot(hit.u, hit.v))), 0);
  }
});

test('spectral filters and lossy splitters retain their wavelength weights without creating power', () => {
  const lines = [{ wavelength: 450, power: 1 }, { wavelength: 532, power: 2 }, { wavelength: 650, power: 3 }];
  const source = optic('source', 'source', [-40, 0, 70], { radius: 4, samples: 31, divergence: 0, power: 6, spectrum: lines });
  const splitter = optic('splitter', 'splitter', [0, 0, 70], { rotation: [0, 0, -45], transmission: 0.4, reflectivity: 0.3 });
  const filter = optic('filter', 'filter', [30, 0, 70], { centerWavelength: 532, bandwidth: 100, transmission: 0.8 });
  const blocked = optic('aperture', 'closed', [0, 30, 70], { rotation: [0, 0, 90], opening: 0 });
  const transmitted = optic('detector', 'transmitted', [70, 0, 70]);
  const reflected = optic('detector', 'reflected', [0, 60, 70], { rotation: [0, 0, 90] });
  const result = traceScene({ parts: [source, splitter, filter, blocked, transmitted, reflected] });
  near(result.emittedPower, 6);
  near(result.detectors[1].power, 0);
  near(result.unresolvedPower, 0);
  let expectedPower = 0;
  for (const line of lines) {
    const expected = line.power * 0.4 * 0.8 * Math.exp(-4 * Math.LN2 * ((line.wavelength - 532) / 100) ** 2);
    expectedPower += expected;
    near(result.detectors[0].spectrum.find(value => value.wavelength === line.wavelength).power, expected);
  }
  near(result.detectedPower, expectedPower);
  near(result.detectors[0].bins.values.reduce((sum, value) => sum + value, 0), expectedPower);
  assert.ok(result.rays.every(ray => ray.power <= ray.inputPower));
  assert.ok(result.detectedPower < result.emittedPower);
});

test('near-grazing grating orders propagate on the real side of the cutoff and evanescent orders terminate', () => {
  const source = optic('source', 'source', [-10, 0, 70], { samples: 1, divergence: 0 });
  const grating = optic('grating', 'grating', [0, 0, 70], { grooveDensity: 1000, transmission: 0.8 });
  const sine = Math.sqrt(1 - 1e-8);
  const cosine = Math.sqrt(1 - sine * sine);
  const detector = optic('detector', 'detector', [200 * cosine, 200 * sine, 70], {
    rotation: [0, 0, Math.atan2(sine, cosine) * 180 / Math.PI], width: 1, height: 1,
  });
  source.wavelength = 1000 * sine;
  const propagating = traceScene({ parts: [source, grating, detector] });
  assert.equal(propagating.rays[0].reason, 'detected');
  near(propagating.detectedPower, 0.8);
  near(propagating.rays[0].pathLength, 210);

  source.wavelength = 1000 * (1 + 5e-9);
  const evanescent = traceScene({ parts: [source, grating, detector] });
  assert.equal(evanescent.rays[0].reason, 'evanescent');
  assert.equal(evanescent.rays[0].power, 0);
  assert.equal(evanescent.detectedPower, 0);
});

test('conical diffraction keeps the groove-parallel direction and zero order is specular', () => {
  const incoming = partAxes({ rotation: [0, -20, 0] }).normal;
  const center = [0, 0, 700];
  const source = optic('source', 'source', plus(center, times(incoming, -50)), {
    samples: 1, divergence: 0, rotation: [0, -20, 0], wavelength: 700,
  });
  for (const reflective of [false, true]) {
    const grating = optic('grating', 'grating', center, { grooveDensity: 1000, reflective, transmission: 1 });
    const result = traceScene({ parts: [source, grating] });
    const ray = result.rays[0];
    const segment = ray.points[2].map((value, index) => value - ray.points[1][index]);
    const outgoing = times(segment, 1 / Math.hypot(...segment));
    near(outgoing[1], 0.7);
    near(outgoing[2], incoming[2]);
    near(outgoing[0], (reflective ? -1 : 1) * Math.sqrt(1 - 0.7 ** 2 - incoming[2] ** 2));
    grating.order = 0;
    const zero = traceScene({ parts: [source, grating] }).rays[0];
    const zeroSegment = zero.points[2].map((value, index) => value - zero.points[1][index]);
    const zeroDirection = times(zeroSegment, 1 / Math.hypot(...zeroSegment));
    near(zeroDirection[0], incoming[0] * (reflective ? -1 : 1));
    near(zeroDirection[1], 0);
    near(zeroDirection[2], incoming[2]);
  }
});

test('distance and interaction limits preserve unresolved power while table hits and free escapes remain distinct', () => {
  const source = optic('source', 'source', [0, 0, 70], { samples: 1, divergence: 0 });
  const detector = optic('detector', 'detector', [80, 0, 70]);
  const limited = traceScene({ parts: [source, detector], maxDistance: 40 });
  assert.equal(limited.rays[0].reason, 'limit');
  near(limited.rays[0].pathLength, 40);
  near(limited.unresolvedPower, 1);
  near(limited.detectedPower, 0);

  const escaped = traceScene({ parts: [source], maxDistance: 500, escapeLength: 100 });
  assert.equal(escaped.rays[0].reason, 'escaped');
  near(escaped.rays[0].pathLength, 100);
  near(escaped.unresolvedPower, 0);

  const down = { ...source, rotation: [0, 90, 0] };
  const table = traceScene({ parts: [down], maxDistance: 70 });
  assert.equal(table.rays[0].reason, 'table');
  near(table.rays[0].pathLength, 70);
  near(table.unresolvedPower, 0);

  const first = optic('mirror', 'first', [10, 0, 70], { reflectivity: 1 });
  const second = optic('mirror', 'second', [-10, 0, 70], { reflectivity: 1 });
  const bounced = traceScene({ parts: [source, first, second], maxInteractions: 3 });
  assert.equal(bounced.rays[0].reason, 'limit');
  near(bounced.rays[0].pathLength, 50);
  near(bounced.unresolvedPower, 1);
});
