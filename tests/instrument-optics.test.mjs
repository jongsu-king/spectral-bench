import assert from 'node:assert/strict';
import test from 'node:test';
import { newOptic } from '../dist/app/instrument-layout.js';
import { createInstrumentScene, traceInstrumentOptics } from '../dist/app/instrument-optics.js';
import { advancedModels } from '../dist/app/models-advanced.js';
import { opticalModels } from '../dist/app/models-optical.js';
import { createPart, partAxes } from '../dist/app/optics3d.js';

const models = { ...opticalModels, ...advancedModels };
const settingsFor = id => Object.fromEntries(models[id].controls.map(({ key, value }) => [key, value]));
const part = (scene, id) => scene.parts.find(component => component.id === id);
const modelResult = (id, settings, trace) => models[id].simulate(settings, { ...trace, mode: 'sample', seed: 41 });

test('all nine measurements respond to 3D lens insertion, mirror insertion, and detector translation', () => {
  for (const id of Object.keys(models)) {
    const settings = settingsFor(id);
    const nominal = traceInstrumentOptics(id, settings);
    const result = modelResult(id, settings, nominal);
    const detector = id === 'thz' ? 'receiver' : 'detector';
    assert.equal(nominal.coupling, 1, id);
    for (const type of ['lens', 'mirror']) {
      const scene = createInstrumentScene(id, settings);
      const optic = newOptic(scene, nominal, type, detector);
      scene.parts.push(optic);
      const edited = traceInstrumentOptics(id, settings, scene);
      assert.ok(edited.rays.some(ray => ray.interactions.some(hit => hit.partId === optic.id)), `${id} ${type}`);
      assert.notDeepEqual(modelResult(id, settings, edited).charts[0], result.charts[0], `${id} ${type}`);
    }
    const scene = createInstrumentScene(id, settings);
    part(scene, detector).position[2] += 75;
    const missed = traceInstrumentOptics(id, settings, scene);
    assert.equal(missed.coupling, 0, id);
    assert.notDeepEqual(modelResult(id, settings, missed).charts[0], result.charts[0], id);
  }
});

test('UV–Vis uses wavelength-dependent ray throughput for a new bandpass filter', () => {
  const settings = settingsFor('uv');
  const scene = createInstrumentScene('uv', settings);
  const lamp = part(scene, 'lamp');
  const filter = createPart('filter', 'test-filter', [lamp.position[0] + 35, ...lamp.position.slice(1)]);
  Object.assign(filter, { centerWavelength: 430, bandwidth: 65 });
  scene.parts.push(filter);
  const result = traceInstrumentOptics('uv', settings, scene);
  assert.ok(result.coupling > 0 && result.coupling < 1);
  assert.ok(result.coupling * result.spectralThroughput(430) > 0.8);
  assert.ok(result.coupling * result.spectralThroughput(680) < 1e-8);
});

test('CCD calibration uses measured anchors and an off-beam lens preserves nominal readout', () => {
  const settings = settingsFor('array');
  const scene = createInstrumentScene('array', settings);
  scene.parts.push(createPart('lens', 'off-beam', [0, 500, 72]));
  assert.equal(traceInstrumentOptics('array', settings, scene).geometry.arrayDetector, undefined);
  part(scene, 'detector').position[1] += 3;
  const reference = traceInstrumentOptics('array', settings, scene, 'reference');
  assert.deepEqual(reference.geometry.arrayDetector.spectrum.map(({ wavelength }) => wavelength), [405, 436, 546, 578, 630]);
  const calibrated = opticalModels.array.simulate(settings, { ...reference, mode: 'reference' });
  assert.equal(calibrated.calibration.lines, 5);
});

test('FTIR measures the moving arm twice and loses interference with a blocked arm', () => {
  const settings = settingsFor('ftir');
  const scene = createInstrumentScene('ftir', settings);
  const moving = part(scene, 'moving');
  moving.position[1] -= 0.02;
  const translated = traceInstrumentOptics('ftir', settings, scene);
  assert.ok(Math.abs(translated.geometry.ftirOpdOffset - 40) < 0.01);
  moving.enabled = false;
  const blocked = traceInstrumentOptics('ftir', settings, scene);
  assert.ok(blocked.opticalTransfer.paths.fixed.power > 0);
  assert.equal(blocked.coupling, 0);
  assert.equal(blocked.geometry.ftirArmVisibility, 0);
});

test('TRPL transit time follows detector displacement and THz depends on the optical gate', () => {
  const trpl = createInstrumentScene('trpl');
  const detector = part(trpl, 'detector');
  const normal = partAxes(detector).normal;
  detector.position = detector.position.map((value, index) => value + 30 * normal[index]);
  const delayed = traceInstrumentOptics('trpl', {}, trpl);
  assert.ok(Math.abs(delayed.geometry.trplDelayOffset - 30 / 299.792458) < 0.0001);

  const thz = createInstrumentScene('thz');
  part(thz, 'gate').rotation[2] += 20;
  const blocked = traceInstrumentOptics('thz', {}, thz);
  assert.ok(blocked.opticalTransfer.paths.signal.power > 0);
  assert.equal(blocked.geometry.gateCoupling, 0);
  assert.equal(blocked.coupling, 0);
});
