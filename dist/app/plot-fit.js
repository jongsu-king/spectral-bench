export const fitModels = Object.freeze({
  gaussian: 'Gaussian',
  lorentzian: 'Lorentzian',
  exponential: 'Exponential decay',
  biexponential: 'Double exponential decay',
  linear: 'Linear',
});

const minimumPoints = { gaussian: 5, lorentzian: 5, exponential: 4, biexponential: 8, linear: 2 };
const parameter = (name, value, unit) => ({ name, value, unit });
const clamp = (value, lower, upper) => Math.max(lower, Math.min(upper, value));
const grid = (lower, upper, count) => Array.from({ length: count }, (_, index) =>
  lower + (upper - lower) * index / (count - 1));
const squared = value => value * value;

function fitSamples(series, model, min, max) {
  const lower = min === undefined || min === null ? -Infinity : min;
  const upper = max === undefined || max === null ? Infinity : max;
  if ((lower !== -Infinity && !Number.isFinite(lower)) ||
      (upper !== Infinity && !Number.isFinite(upper)) || lower >= upper) {
    throw new Error('Enter a fit range with the lower value below the upper value.');
  }

  const samples = [];
  const count = Math.min(series?.x?.length ?? 0, series?.y?.length ?? 0);
  for (let index = 0; index < count; index += 1) {
    const x = series.x[index];
    const y = series.y[index];
    if (Number.isFinite(x) && Number.isFinite(y) && x >= lower && x <= upper) samples.push({ x, y });
  }
  samples.sort((first, second) => first.x - second.x);
  const distinct = new Set(samples.map(sample => sample.x));
  const minimum = minimumPoints[model];
  if (distinct.size < minimum) {
    throw new Error('Select at least ' + minimum + ' distinct measured points for this fit.');
  }

  const xOrigin = samples[0].x;
  const xScale = samples.at(-1).x - xOrigin;
  const yOrigin = samples[0].y;
  let yScale = 0;
  let spacing = xScale;
  for (const [index, sample] of samples.entries()) {
    yScale = Math.max(yScale, Math.abs(sample.y - yOrigin));
    const gap = index && sample.x - samples[index - 1].x;
    if (gap > 0) spacing = Math.min(spacing, gap);
  }
  if (!Number.isFinite(xScale) || !Number.isFinite(yScale)) {
    throw new Error('The selected data span is too large to fit.');
  }
  if (!yScale && model !== 'linear') {
    throw new Error('The signal is flat in the fit range.');
  }
  yScale ||= 1;
  const x = samples.map(sample => (sample.x - xOrigin) / xScale);
  const y = samples.map(sample => (sample.y - yOrigin) / yScale);
  return { samples, x, y, xOrigin, xScale, yOrigin, yScale, spacing: spacing / xScale };
}

// At fixed nonlinear parameters the baseline and amplitudes are linear.
// Center the shape functions so the constant background drops out of the solve.
function linearSolver(x, y) {
  const count = x.length;
  const mean = y.reduce((sum, value) => sum + value, 0) / count;
  const centered = y.map(value => value - mean);
  const first = new Float64Array(count);
  const second = new Float64Array(count);

  return (shape, extra) => {
    let sumFirst = 0, sumSecond = 0;
    let squareFirst = 0, squareSecond = 0, cross = 0;
    let signalFirst = 0, signalSecond = 0;
    for (let index = 0; index < count; index += 1) {
      const a = first[index] = shape(x[index]);
      const b = second[index] = extra ? extra(x[index]) : 0;
      sumFirst += a;
      sumSecond += b;
      squareFirst += a * a;
      squareSecond += b * b;
      cross += a * b;
      signalFirst += a * centered[index];
      signalSecond += b * centered[index];
    }
    const varianceFirst = squareFirst - sumFirst * sumFirst / count;
    if (!(varianceFirst > 1e-14)) return null;

    let amplitude = signalFirst / varianceFirst;
    let extraAmplitude = 0;
    if (extra) {
      const varianceSecond = squareSecond - sumSecond * sumSecond / count;
      const covariance = cross - sumFirst * sumSecond / count;
      const determinant = varianceFirst * varianceSecond - covariance * covariance;
      if (!(varianceSecond > 1e-14 && determinant > varianceFirst * varianceSecond * 1e-10)) return null;
      amplitude = (signalFirst * varianceSecond - signalSecond * covariance) / determinant;
      extraAmplitude = (signalSecond * varianceFirst - signalFirst * covariance) / determinant;
    }
    const offset = mean - (amplitude * sumFirst + extraAmplitude * sumSecond) / count;
    let error = 0;
    for (let index = 0; index < count; index += 1) {
      error += squared(y[index] - offset - amplitude * first[index] - extraAmplitude * second[index]);
    }
    return { error, offset, amplitude, extraAmplitude, shape, extra };
  };
}

function minimize(evaluate, candidates, dimension) {
  const score = point => {
    const fit = evaluate(point);
    return { point, fit, error: fit?.error ?? Infinity };
  };
  let best = score(candidates[0]);
  for (const candidate of candidates.slice(1)) {
    const test = score(candidate);
    if (test.error < best.error) best = test;
  }
  if (!best.fit) throw new Error('The fit could not resolve a model in this range.');

  // A coarse grid provides a reproducible start for bounded Nelder–Mead refinement.
  const simplex = [best];
  for (let axis = 0; axis < dimension; axis += 1) {
    const direction = best.point[axis] > 0.85 ? -1 : 1;
    const point = best.point.map((value, index) => index === axis ? clamp(value + direction * 0.06, 0, 1) : value);
    simplex.push(score(point));
  }
  let converged = false;
  for (let iteration = 0; iteration < 240; iteration += 1) {
    simplex.sort((first, second) => first.error - second.error);
    best = simplex[0];
    const spread = Math.max(...simplex.map(vertex =>
      Math.max(...vertex.point.map((value, axis) => Math.abs(value - best.point[axis])))));
    if (spread < 1e-7) {
      converged = true;
      break;
    }
    const worst = simplex[dimension];
    const centroid = best.point.map((_, axis) => simplex.slice(0, dimension)
      .reduce((sum, vertex) => sum + vertex.point[axis], 0) / dimension);
    const step = factor => score(centroid.map((value, axis) =>
      clamp(value + factor * (value - worst.point[axis]), 0, 1)));
    const reflected = step(1);
    if (reflected.error < best.error) {
      const expanded = step(2);
      simplex[dimension] = expanded.error < reflected.error ? expanded : reflected;
    } else if (reflected.error < simplex[dimension - 1].error) {
      simplex[dimension] = reflected;
    } else {
      const outside = reflected.error < worst.error;
      const contracted = step(outside ? 0.5 : -0.5);
      if (contracted.error < (outside ? reflected.error : worst.error)) {
        simplex[dimension] = contracted;
      } else {
        for (let index = 1; index < simplex.length; index += 1) {
          simplex[index] = score(best.point.map((value, axis) => (value + simplex[index].point[axis]) / 2));
        }
      }
    }
  }
  simplex.sort((first, second) => first.error - second.error);
  return { ...simplex[0], converged };
}

function peakFit(solve, samples, model) {
  const { x, y, xOrigin, xScale, spacing, yScale, yOrigin } = samples;
  const narrowest = clamp(spacing * 0.5, 0.000001, 0.15);
  const widthAt = position => narrowest * (3 / narrowest) ** position;
  const shapeAt = model === 'gaussian'
    ? (center, width) => value => Math.exp(-0.5 * squared((value - center) / width))
    : (center, width) => value => 1 / (1 + squared((value - center) / width));
  let low = 0;
  let high = 0;
  for (let index = 1; index < y.length; index += 1) {
    if (y[index] < y[low]) low = index;
    if (y[index] > y[high]) high = index;
  }
  const centers = [...new Set([...grid(0, 1, 19), x[low], x[high]])];
  const widths = grid(0, 1, 14);
  const candidates = centers.flatMap(center => widths.map(width => [center, width]));
  const result = minimize(([center, width]) => solve(shapeAt(center, widthAt(width))), candidates, 2);
  const [center, width] = result.point;
  const fwhm = model === 'gaussian' ? 2 * Math.sqrt(2 * Math.log(2)) : 2;
  const warning = width < 1e-5 || width > 1 - 1e-5
    ? 'The peak width reached a fit bound.'
    : center < 1e-5 || center > 1 - 1e-5 ? 'The peak center reached the edge of the fit range.' : null;
  return { ...result, warning, parameters: [
    parameter('Center', xOrigin + center * xScale, 'x'),
    parameter('FWHM', fwhm * widthAt(width) * xScale, 'x'),
    parameter('Amplitude', result.fit.amplitude * yScale, 'y'),
    parameter('Baseline', yOrigin + result.fit.offset * yScale, 'y'),
  ] };
}

function decayFit(solve, samples, model) {
  const { xOrigin, xScale, spacing, yOrigin, yScale } = samples;
  const shortest = clamp(spacing * 0.5, 0.000001, 0.15);
  const timeAt = position => shortest * (40 / shortest) ** position;
  const shapeAt = position => {
    const time = timeAt(position);
    return value => Math.exp(-value / time);
  };
  const times = grid(0, 1, 22);
  const multiple = model === 'biexponential';
  const evaluate = ([short, long]) => {
    if (!multiple) return solve(shapeAt(short));
    if (timeAt(long) / timeAt(short) < 1.12) return null;
    return solve(shapeAt(short), shapeAt(long));
  };
  const candidates = multiple
    ? times.flatMap((short, index) => times.slice(index + 1).map(long => [short, long]))
    : times.map(time => [time]);
  const result = minimize(evaluate, candidates, multiple ? 2 : 1);
  const [short, long] = result.point;
  const { amplitude, extraAmplitude, offset } = result.fit;
  const parameters = multiple ? [
    parameter('τ₁', timeAt(short) * xScale, 'x'),
    parameter('τ₂', timeAt(long) * xScale, 'x'),
    parameter('Amplitude 1', amplitude * yScale, 'y'),
    parameter('Amplitude 2', extraAmplitude * yScale, 'y'),
  ] : [
    parameter('τ', timeAt(short) * xScale, 'x'),
    parameter('Amplitude', amplitude * yScale, 'y'),
  ];
  parameters.push(parameter('Baseline', yOrigin + offset * yScale, 'y'), parameter('Origin', xOrigin, 'x'));
  let warning = null;
  if (result.point.some(value => value < 1e-5 || value > 1 - 1e-5)) {
    warning = 'A time constant reached a fit bound.';
  } else if (multiple && (timeAt(long) / timeAt(short) < 1.18 ||
    Math.min(Math.abs(amplitude), Math.abs(extraAmplitude)) < Math.max(Math.abs(amplitude), Math.abs(extraAmplitude)) * 1e-4)) {
    warning = 'The range does not resolve two independent time constants.';
  }
  return { ...result, warning, parameters };
}

export function fitTrace(series, { model = 'gaussian', min, max } = {}) {
  if (!Object.hasOwn(fitModels, model)) throw new Error('Select a valid fit model.');
  const data = fitSamples(series, model, min, max);
  const solve = linearSolver(data.x, data.y);
  let result;
  if (model === 'gaussian' || model === 'lorentzian') {
    result = peakFit(solve, data, model);
  } else if (model === 'linear') {
    const fit = solve(value => value);
    const slope = fit.amplitude * data.yScale / data.xScale;
    result = { fit, converged: true, parameters: [
      parameter('Slope', slope, 'y/x'),
      parameter('Intercept', data.yOrigin + fit.offset * data.yScale - slope * data.xOrigin, 'y'),
    ] };
  } else {
    result = decayFit(solve, data, model);
  }

  const { offset, amplitude, extraAmplitude, shape, extra, error } = result.fit;
  const count = data.samples.length;
  const x = data.samples.map(sample => sample.x);
  const predicted = data.x.map(value => offset + amplitude * shape(value) +
    (extra ? extraAmplitude * extra(value) : 0));
  const mean = data.y.reduce((sum, value) => sum + value, 0) / count;
  const total = data.y.reduce((sum, value) => sum + squared(value - mean), 0);
  return {
    model,
    curve: { x, y: predicted.map(value => data.yOrigin + value * data.yScale) },
    residual: { x: [...x], y: data.y.map((value, index) => (value - predicted[index]) * data.yScale) },
    parameters: result.parameters,
    rmse: Math.sqrt(error / count) * data.yScale,
    r2: total > 0 ? 1 - error / total : null,
    count,
    converged: result.converged && !result.warning,
    warning: result.warning ?? (result.converged ? null : 'The optimizer stopped before converging.'),
  };
}
