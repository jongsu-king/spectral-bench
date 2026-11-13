import assert from 'node:assert/strict';
import test from 'node:test';
import { fitTrace } from '../dist/app/plot-fit.js';

const samples = (count, start, step, response) => {
  const x = Array.from({ length: count }, (_, index) => start + step * index);
  return { x, y: x.map(response) };
};

const estimate = (fit, name) => fit.parameters.find(parameter => parameter.name === name)?.value;
const near = (actual, expected, tolerance) => assert.ok(
  Math.abs(actual - expected) < tolerance, `Expected ${expected}, got ${actual}`,
);

test('Gaussian fitting recovers a negative dip from sorted finite pairs within the selected range', () => {
  const trace = samples(161, 1000, 0.5, x => 0.7 - 3.1 * Math.exp(-0.5 * ((x - 1037.6) / 3.4) ** 2));
  trace.y[0] = 1e4;
  trace.y[60] = NaN;
  trace.y[63] = null;
  trace.x.reverse();
  trace.y.reverse();
  const result = fitTrace(trace, { model: 'gaussian', min: 1010, max: 1070 });
  assert.equal(result.count, 119);
  assert.equal(result.converged, true);
  assert.ok(result.curve.x.every(x => x >= 1010 && x <= 1070));
  near(estimate(result, 'Center'), 1037.6, 0.0001);
  near(estimate(result, 'FWHM'), 3.4 * Math.sqrt(8 * Math.log(2)), 0.0001);
  near(estimate(result, 'Amplitude'), -3.1, 0.0001);
  near(estimate(result, 'Baseline'), 0.7, 0.0001);
  assert.ok(result.rmse < 1e-5);
  assert.ok(result.residual.y.every(Number.isFinite));
});

test('Lorentzian fitting recovers FWHM and center from a narrow line with deterministic noise', () => {
  const trace = samples(321, 0, 0.05, (x, index) => 9 + 17 / (1 + ((x - 9.63) / 0.16) ** 2) + 0.08 * Math.sin(index * 31));
  const result = fitTrace(trace, { model: 'lorentzian' });
  near(estimate(result, 'Center'), 9.63, 0.005);
  near(estimate(result, 'FWHM'), 0.32, 0.01);
  assert.ok(result.r2 > 0.999);
});

test('exponential fits recover single and separated double decay time constants', () => {
  const single = samples(200, 20, 0.08, x => 6.3 - 4.1 * Math.exp(-(x - 20) / 2.8));
  const selected = fitTrace(single, { model: 'exponential', min: 21.6 });
  near(estimate(selected, 'Origin'), 21.6, 1e-10);
  near(estimate(selected, 'τ'), 2.8, 0.0001);
  near(estimate(selected, 'Amplitude'), -4.1 * Math.exp(-1.6 / 2.8), 0.0001);

  const multiple = samples(241, 0, 0.1, x => 5 + 16 * Math.exp(-x / 0.65) + 8 * Math.exp(-x / 4.8));
  const result = fitTrace(multiple, { model: 'biexponential' });
  near(estimate(result, 'τ₁'), 0.65, 0.0001);
  near(estimate(result, 'τ₂'), 4.8, 0.0001);
  near(estimate(result, 'Amplitude 2'), 8, 0.0001);
  assert.equal(result.converged, true);
  assert.ok(result.rmse < 1e-5);
});

test('linear regression reports a constant signal without dividing by zero and validates fit ranges', () => {
  const result = fitTrace({ x: [4, 3], y: [7, 7] }, { model: 'linear' });
  assert.equal(result.r2, null);
  assert.equal(result.rmse, 0);
  assert.equal(estimate(result, 'Slope'), 0);
  assert.equal(estimate(result, 'Intercept'), 7);
  assert.throws(() => fitTrace({ x: [0, 1], y: [2, 3] }, { min: 2, max: 1 }), /fit range/);
  assert.throws(() => fitTrace({ x: [0, 0, 0, 1, 2], y: [2, 2, 2, 3, 5] }), /distinct measured points/);
});
