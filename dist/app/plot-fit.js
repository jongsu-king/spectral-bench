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

function norm(values) {
  let scale = 0;
  let sum = 1;
  for (const value of values) {
    const absolute = Math.abs(value);
    if (!absolute) continue;
    if (absolute > scale) {
      sum = 1 + sum * squared(scale / absolute);
      scale = absolute;
    } else {
      sum += squared(absolute / scale);
    }
  }
  return scale * Math.sqrt(sum);
}

const dot = (first, second) => first.reduce((sum, value, index) => sum + value * second[index], 0);

// Factor the column-scaled Jacobian, with pivoting and a second orthogonalization
// pass. Keeping R rather than JᵀJ avoids squaring the conditioning of the solve.
function factorJacobian(rows) {
  const count = rows[0].length;
  const columns = Array.from({ length: count }, (_, column) => rows.map(row => row[column]));
  const scales = columns.map(norm);
  if (scales.some(value => !(value > 0) || !Number.isFinite(value))) return null;
  columns.forEach((column, index) => column.forEach((value, row) => { column[row] = value / scales[index]; }));
  const order = Array.from({ length: count }, (_, index) => index);
  const upper = Array.from({ length: count }, () => Array(count).fill(0));
  for (let pivot = 0; pivot < count; pivot += 1) {
    let best = pivot;
    for (let index = pivot + 1; index < count; index += 1) {
      if (norm(columns[index]) > norm(columns[best])) best = index;
    }
    [columns[pivot], columns[best]] = [columns[best], columns[pivot]];
    [order[pivot], order[best]] = [order[best], order[pivot]];
    for (let row = 0; row < pivot; row += 1) {
      [upper[row][pivot], upper[row][best]] = [upper[row][best], upper[row][pivot]];
    }
    const length = norm(columns[pivot]);
    if (!(length > 1e-12)) return null;
    upper[pivot][pivot] = length;
    const q = columns[pivot].map(value => value / length);
    for (let column = pivot + 1; column < count; column += 1) {
      const projection = dot(q, columns[column]);
      columns[column].forEach((value, row) => { columns[column][row] = value - projection * q[row]; });
      const correction = dot(q, columns[column]);
      columns[column].forEach((value, row) => { columns[column][row] = value - correction * q[row]; });
      upper[pivot][column] = projection + correction;
    }
  }
  const inverse = Array.from({ length: count }, () => Array(count).fill(0));
  for (let column = 0; column < count; column += 1) {
    for (let row = count - 1; row >= 0; row -= 1) {
      let value = row === column ? 1 : 0;
      for (let next = row + 1; next < count; next += 1) value -= upper[row][next] * inverse[next][column];
      inverse[row][column] = value / upper[row][row];
    }
  }
  const infinityNorm = matrix => Math.max(...matrix.map(row => row.reduce((sum, value) => sum + Math.abs(value), 0)));
  const condition = infinityNorm(upper) * infinityNorm(inverse);
  if (!Number.isFinite(condition) || condition > 1e8) return null;
  return { inverse, scales, order, condition };
}

function fitJacobian(data, result, model) {
  const { xScale, xOrigin, yScale } = data;
  const { amplitude, extraAmplitude, shape, extra } = result.fit;
  let rows, transform;
  if (model === 'linear') {
    rows = data.x.map(value => [value, 1]);
    transform = [[yScale / xScale, 0], [-yScale * (xOrigin / xScale), yScale]];
  } else if (model === 'gaussian' || model === 'lorentzian') {
    const factor = model === 'gaussian' ? Math.sqrt(8 * Math.log(2)) : 2;
    const width = result.parameters[1].value / xScale / factor;
    const center = result.point[0];
    rows = data.x.map(value => {
      const difference = value - center;
      const profile = shape(value);
      const common = model === 'gaussian' ? amplitude * profile : 2 * amplitude * profile * profile;
      return [common * difference / squared(width), common * squared(difference) / width ** 3, profile, 1];
    });
    transform = [xScale, factor * xScale, yScale, yScale].map((scale, index, values) =>
      values.map((_, column) => column === index ? scale : 0));
  } else {
    const first = result.parameters[0].value / xScale;
    const multiple = model === 'biexponential';
    const second = multiple ? result.parameters[1].value / xScale : null;
    rows = data.x.map(value => multiple
      ? [amplitude * shape(value) * value / squared(first),
        extraAmplitude * extra(value) * value / squared(second), shape(value), extra(value), 1]
      : [amplitude * shape(value) * value / squared(first), shape(value), 1]);
    const scales = multiple ? [xScale, xScale, yScale, yScale, yScale] : [xScale, yScale, yScale];
    transform = scales.map((scale, index) => scales.map((_, column) => column === index ? scale : 0));
    transform.push(null); // Origin is the fixed lower observed X, not a fitted parameter.
  }
  return { rows, transform };
}

function fitUncertainty(data, result, model) {
  const fixedOrigin = model === 'exponential' || model === 'biexponential';
  const parameters = result.parameters.map((entry, index, entries) => ({
    ...entry, standardError: null, fixed: fixedOrigin && index === entries.length - 1,
  }));
  const parameterCount = parameters.filter(entry => !entry.fixed).length;
  const degreesOfFreedom = data.samples.length - parameterCount;
  const residualScale = degreesOfFreedom > 0 ? Math.sqrt(result.fit.error / degreesOfFreedom) : null;
  const residualStandardDeviation = residualScale === null ? null : residualScale * data.yScale;
  const method = 'Local unweighted least squares';
  const unavailable = reason => ({ parameters, parameterCount, degreesOfFreedom, residualStandardDeviation,
    covariance: null, uncertainty: { available: false, method, reason } });
  if (degreesOfFreedom <= 0) return unavailable('More observations than fitted parameters are needed to estimate standard errors.');
  if (!result.converged || result.warning) return unavailable('Standard errors are unavailable for an unconverged, bounded, or unresolved fit.');
  const { rows, transform } = fitJacobian(data, result, model);
  const factor = factorJacobian(rows);
  if (!factor) return unavailable('The parameter Jacobian is rank deficient or too ill-conditioned to estimate standard errors.');

  // Covariance = RSS/(n−p) · (JᵀJ)⁻¹. Transform the QR factors directly into the
  // reported parameter units; no physical-unit normal matrix is formed.
  const basis = transform.map(row => row && factor.inverse.map((_, column) => {
    let value = 0;
    for (let index = 0; index < parameterCount; index += 1) {
      value += row[factor.order[index]] / factor.scales[factor.order[index]] * factor.inverse[index][column];
    }
    return value * residualScale;
  }));
  if (basis.some(row => row?.some(value => !Number.isFinite(value)))) {
    return unavailable('The standard-error calculation exceeds the supported numeric range.');
  }
  const covariance = basis.map(first => first && basis.map(second => second ? dot(first, second) : null));
  if (covariance.some(row => row?.some(value => value !== null && !Number.isFinite(value)))) {
    return unavailable('The covariance calculation exceeds the supported numeric range.');
  }
  return {
    parameters: parameters.map((entry, index) => ({ ...entry, standardError: basis[index] ? norm(basis[index]) : null })),
    parameterCount, degreesOfFreedom, residualStandardDeviation, covariance,
    uncertainty: { available: true, method, reason: null, scaledJacobianCondition: factor.condition },
  };
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
    ...fitUncertainty(data, result, model),
    rmse: Math.sqrt(error / count) * data.yScale,
    r2: total > 0 ? 1 - error / total : null,
    count,
    converged: result.converged && !result.warning,
    warning: result.warning ?? (result.converged ? null : 'The optimizer stopped before converging.'),
  };
}
