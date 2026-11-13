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
