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

test('linear standard errors and covariance match the closed-form regression calculation', () => {
  const trace = { x: [-2, -0.5, 0.5, 3, 4.5, 8], y: [-2.8, -0.1, 1.3, 6.5, 8.4, 15.7] };
  const result = fitTrace(trace, { model: 'linear' });
  const n = trace.x.length;
  const meanX = trace.x.reduce((sum, value) => sum + value, 0) / n;
  const sxx = trace.x.reduce((sum, value) => sum + (value - meanX) ** 2, 0);
  const rss = result.residual.y.reduce((sum, value) => sum + value ** 2, 0);
  const variance = rss / (n - 2);
  const expected = [
    [variance / sxx, -meanX * variance / sxx],
    [-meanX * variance / sxx, variance * (1 / n + meanX ** 2 / sxx)],
  ];
  assert.equal(result.uncertainty.available, true);
  assert.equal(result.parameterCount, 2);
  assert.equal(result.degreesOfFreedom, n - 2);
  near(result.residualStandardDeviation, Math.sqrt(variance), 1e-12);
  for (let first = 0; first < 2; first += 1) {
    near(result.parameters[first].standardError, Math.sqrt(expected[first][first]), 1e-12);
    for (let second = 0; second < 2; second += 1) near(result.covariance[first][second], expected[first][second], 1e-12);
  }
});

const reportedResponse = (model, parameters, x) => {
  const values = Object.fromEntries(parameters.map(entry => [entry.name, entry.value]));
  if (model === 'gaussian') {
    const sigma = values.FWHM / Math.sqrt(8 * Math.log(2));
    return values.Baseline + values.Amplitude * Math.exp(-0.5 * ((x - values.Center) / sigma) ** 2);
  }
  if (model === 'lorentzian') {
    return values.Baseline + values.Amplitude / (1 + ((x - values.Center) / (values.FWHM / 2)) ** 2);
  }
  const time = x - values.Origin;
  if (model === 'exponential') return values.Baseline + values.Amplitude * Math.exp(-time / values['τ']);
  return values.Baseline + values['Amplitude 1'] * Math.exp(-time / values['τ₁']) +
    values['Amplitude 2'] * Math.exp(-time / values['τ₂']);
};

test('nonlinear covariance agrees with an independent finite-difference Jacobian in reported units', () => {
  const responses = {
    gaussian: x => 2 + 7 * Math.exp(-0.5 * ((x - 6) / 1.3) ** 2),
    lorentzian: x => 2 + 7 / (1 + ((x - 6) / 1.3) ** 2),
    exponential: x => 2 + 7 * Math.exp(-x / 2.3),
    biexponential: x => 2 + 7 * Math.exp(-x / 0.7) + 3 * Math.exp(-x / 4),
  };
  for (const [model, response] of Object.entries(responses)) {
    const trace = samples(241, 0, 0.05, (x, index) => response(x) + 0.03 * Math.sin(index * 31));
    const result = fitTrace(trace, { model });
    assert.equal(result.uncertainty.available, true, model);
    const count = result.parameterCount;
    const derivatives = result.parameters.slice(0, count).map((entry, column) => {
      const step = Math.max(Math.abs(entry.value), 1) * 1e-5;
      const perturbed = offset => result.parameters.map((value, index) => ({
        ...value, value: value.value + (index === column ? offset : 0),
      }));
      return trace.x.map(x => (reportedResponse(model, perturbed(step), x) - reportedResponse(model, perturbed(-step), x)) / (2 * step));
    });
    const information = derivatives.map(first => derivatives.map(second =>
      first.reduce((sum, value, index) => sum + value * second[index], 0)));
    const variance = result.residualStandardDeviation ** 2;
    for (let row = 0; row < count; row += 1) {
      near(result.parameters[row].standardError ** 2, result.covariance[row][row], 1e-14);
      for (let column = 0; column < count; column += 1) {
        const product = information[row].reduce((sum, value, index) =>
          sum + value * result.covariance[index][column], 0) / variance;
        near(product, row === column ? 1 : 0, 0.00002);
        near(result.covariance[row][column], result.covariance[column][row], 1e-14);
      }
    }
    if (model.endsWith('exponential')) {
      const origin = result.parameters.at(-1);
      assert.equal(origin.fixed, true);
      assert.equal(origin.standardError, null);
      assert.equal(result.covariance.at(-1), null);
      assert.equal(result.degreesOfFreedom, result.count - (model === 'exponential' ? 3 : 5));
    }
  }
});

test('standard errors transform consistently when the signal and X units change', () => {
  const trace = samples(181, 0, 0.1, (x, index) => 5 + 9 * Math.exp(-0.5 * ((x - 8) / 1.4) ** 2) + 0.05 * Math.cos(index * 17));
  const initial = fitTrace(trace, { model: 'gaussian' });
  const changed = fitTrace({ x: trace.x.map(value => 1e9 + 1e3 * value),
    y: trace.y.map(value => 1e8 + 1e5 * value) }, { model: 'gaussian' });
  assert.equal(changed.uncertainty.available, true);
  for (const [index, entry] of initial.parameters.entries()) {
    const scale = entry.unit === 'x' ? 1e3 : 1e5;
    near(changed.parameters[index].standardError / scale, entry.standardError, entry.standardError * 1e-5);
  }
  near(changed.residualStandardDeviation / 1e5, initial.residualStandardDeviation, 1e-10);
});

test('standard errors are withheld without residual degrees of freedom and at unresolved fit bounds', () => {
  const twoPoint = fitTrace({ x: [3, 4], y: [7, 8] }, { model: 'linear' });
  assert.equal(twoPoint.converged, true);
  assert.equal(twoPoint.degreesOfFreedom, 0);
  assert.equal(twoPoint.residualStandardDeviation, null);
  assert.equal(twoPoint.covariance, null);
  assert.equal(twoPoint.uncertainty.available, false);
  assert.match(twoPoint.uncertainty.reason, /More observations/);
  assert.ok(twoPoint.parameters.every(entry => entry.standardError === null));

  const partialPeak = fitTrace(samples(201, 0, 0.05, x => 3 + 4 * Math.exp(-0.5 * ((x - 12) / 2) ** 2)), { model: 'gaussian' });
  assert.match(partialPeak.warning, /edge/);
  assert.equal(partialPeak.uncertainty.available, false);
  assert.equal(partialPeak.covariance, null);
  assert.ok(partialPeak.parameters.every(entry => entry.standardError === null));

  const singleAsDouble = fitTrace(samples(201, 0, 0.05, x => 2 + 5 * Math.exp(-x / 1.5)), { model: 'biexponential' });
  assert.match(singleAsDouble.warning, /independent time constants/);
  assert.equal(singleAsDouble.uncertainty.available, false);
  assert.ok(singleAsDouble.parameters.every(entry => entry.standardError === null));
});
