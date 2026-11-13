import assert from 'node:assert/strict';
import test from 'node:test';
import { opticalModels } from '../dist/app/models-optical.js';
import { advancedModels } from '../dist/app/models-advanced.js';
import { traceBench } from '../dist/app/bench.js';

const models = { ...opticalModels, ...advancedModels };

function defaults(id) {
  return Object.fromEntries(models[id].controls.map(({ key, value }) => [key, value]));
}

function run(id, overrides = {}, context = {}) {
  const settings = { ...defaults(id), alignment: 0, ...overrides };
  const coupling = traceBench(id, settings).coupling;
  const result = models[id].simulate(settings, { seed: 631, mode: 'sample', coupling, ...context });
  return { result, settings, coupling };
}

function metric({ result }, name) {
  return Number(result.metrics.find(({ label }) => label === name)?.value);
}

test('all nine instruments trace optics and produce finite detector data', () => {
  assert.equal(Object.keys(models).length, 9);
  for (const id of Object.keys(models)) {
    const { result, settings, coupling } = run(id);
    assert(coupling > 0, id);
    assert(traceBench(id, settings).parts.length >= 4, id);
    assert(result.charts.length >= 2, id);
    for (const chart of result.charts) {
      for (const { x, y } of chart.series ?? []) {
        assert.equal(x.length, y.length, chart.title);
        assert(y.some(Number.isFinite), chart.title);
      }
    }
  }
});

test('CCD counts follow the traced hit pixels and reference calibration', () => {
  const settings = { rotation: 0.8 };
  const reference = run('array', settings, { mode: 'reference' });
  const sample = run('array', settings, { reference });
  const hits = sample.result.bench.hits;
  const strongest = metric(sample, 'Peak pixel');
  assert(hits.some(hit => Math.abs(hit.pixel - strongest) <= 1));
  assert(Math.abs(sample.result.peak - 520) < 0.1);
});

test('moving the CCD changes the detected pixel and can remove the detector signal', () => {
  const [x, y] = traceBench('array').parts.find(part => part.id === 'detector').point;
  const offset = distance => ({ positions: { detector: { x, y: y + distance } } });
  const nominal = run('array');
  const settings = offset(8);
  const displaced = run('array', settings);
  const peak = metric(displaced, 'Peak pixel');
  assert(Math.abs(peak - metric(nominal, 'Peak pixel')) > 1);
  assert(displaced.result.bench.hits.some(hit => hit.detectorHit && Math.abs(hit.pixel - peak) <= 1));

  const reference = run('array', settings, { mode: 'reference' });
  assert(Math.abs(run('array', settings, { reference }).result.peak - 520) < 0.6);

  const missed = run('array', offset(90)).result;
  assert(missed.bench.hits.length > 0);
  assert(missed.bench.hits.every(hit => !hit.detectorHit));
  assert(missed.charts[1].series[0].y.every(count => count === 0));
});

test('UV–Vis corrects measured baselines and integrates specular light', () => {
  const dark = run('uv', {}, { mode: 'dark' });
  const reference = run('uv', {}, { mode: 'reference', dark });
  const full = run('uv', {}, { reference, dark });
  const half = run('uv', { concentration: 0.5 }, { reference, dark });
  const blank = run('uv', { concentration: 0 }, { reference, dark });
  assert(Math.abs(metric(full, 'Peak absorbance') - 2 * metric(half, 'Peak absorbance')) < 0.005);
  assert(Math.abs(metric(blank, 'Peak absorbance')) < 0.001);

  const white = run('uv', { mode: 'sphere' }, { mode: 'reference', dark });
  const total = metric(run('uv', { mode: 'sphere' }, { reference: white, dark }), 'Reflectance at 550 nm');
  const diffuse = metric(run('uv', { mode: 'sphere', specular: false }, { reference: white, dark }), 'Reflectance at 550 nm');
  assert(total > diffuse + 5);
});

test('moving the UV–Vis detector off-axis reduces its signal to the dark baseline', () => {
  const [x, y] = traceBench('uv').parts.find(part => part.id === 'detector').point;
  const offset = distance => ({ positions: { detector: { x, y: y + distance } } });
  const nominal = run('uv');
  const partiallyAligned = run('uv', offset(8));
  const missed = run('uv', offset(45));
  assert(partiallyAligned.coupling > 0 && partiallyAligned.coupling < nominal.coupling);
  assert.equal(missed.coupling, 0);

  const rawCounts = measurement => measurement.result.charts[0].series[0].y;
  assert(rawCounts(partiallyAligned).every((count, index) => count < rawCounts(nominal)[index]));
  const dark = run('uv', {}, { mode: 'dark' });
  assert.deepEqual(rawCounts(missed), rawCounts(dark));
});

test('TRPL retrieves a known lifetime and demonstrates pile-up recovery', () => {
  const reference = run('trpl', {}, { mode: 'reference' });
  const low = metric(run('trpl', {}, { reference }), 'Fitted lifetime');
  const high = metric(run('trpl', { flux: 150 }, { reference }), 'Fitted lifetime');
  const attenuated = metric(run('trpl', { flux: 150, attenuation: 2 }, { reference }), 'Fitted lifetime');
  assert(Math.abs(low - 4) <= 0.2);
  assert(high < low - 0.5);
  assert(Math.abs(attenuated - 4) <= 0.2);
});

test('Raman shift stays fixed when the laser wavelength changes', () => {
  const green = run('raman', { laser: '532' });
  const infrared = run('raman', { laser: '785' });
  assert.equal(metric(green, 'Principal Raman band'), metric(infrared, 'Principal Raman band'));
  assert(green.result.peak < infrared.result.peak);
});

test('ellipsometry retrieves film thickness and TA switches off the differential spectrum', () => {
  const film = run('ellipsometry', { thickness: 207 });
  assert(Math.abs(metric(film, 'Fitted film thickness') - 207) < 0.5);
  const unpumped = run('ta', { pump: false }).result.charts.find(chart => chart.heatmap);
  assert(unpumped.heatmap.z.every(row => row.every(value => Math.abs(value) < 1e-12)));
});

test('THz time waveform and complex transfer recover a synthetic slab', () => {
  const reference = run('thz', {}, { mode: 'reference' });
  const transparent = run('thz', {}, { reference });
  assert(Math.abs(metric(transparent, 'Primary pulse delay') - 1.67) <= 0.02);
  assert(Math.abs(metric(transparent, 'Mean retrieved refractive index') - 1.50) <= 0.02);
  const waveform = transparent.result.charts[0].series[1];
  const peakIn = (low, high) => waveform.x.reduce((best, x, i) => {
    if (x < low || x > high) return best;
    if (best < 0 || Math.abs(waveform.y[i]) > Math.abs(waveform.y[best])) return i;
    return best;
  }, -1);
  assert(Math.abs(waveform.x[peakIn(17, 20)] - waveform.x[peakIn(7, 9)] - 10) <= 0.1);
  const lossy = run('thz', { thickness: 0.6, index: 1.7, absorption: 12 }, { reference });
  assert(Math.abs(metric(lossy, 'Mean retrieved refractive index') - 1.7) <= 0.02);
  assert(Math.abs(metric(lossy, 'Mean retrieved absorption coefficient') - 12) <= 0.2);
});
