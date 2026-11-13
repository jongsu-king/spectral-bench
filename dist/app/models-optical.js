const degrees = Math.PI / 180;
const fwhmToSigma = 2 * Math.sqrt(2 * Math.log(2));
const clamp = (value, lower, upper) => Math.max(lower, Math.min(upper, value));
const gaussian = (x, center, sigma) => Math.exp(-0.5 * ((x - center) / sigma) ** 2);
const grid = (first, last, step) => Array.from(
  { length: Math.floor((last - first) / step) + 1 },
  (_, index) => first + index * step,
);
const sum = values => values.reduce((total, value) => total + value, 0);

function spectralFactor(ctx, wavelength) {
  return ctx.spectralThroughput?.(wavelength) ?? 1;
}

function peakIndex(values) {
  let maximum = 0;
  for (let i = 1; i < values.length; i += 1) {
    if (!Number.isNaN(values[i]) && (Number.isNaN(values[maximum]) || values[i] > values[maximum])) maximum = i;
  }
  return maximum;
}

function format(value, digits = 2) {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function range(key, label, value, min, max, step, unit, when) {
  return { key, label, type: 'range', value, min, max, step, unit, when };
}

function select(key, label, value, options, when) {
  return {
    key, label, type: 'select', value,
    options: options.map(([value, label]) => ({ value, label })),
    when,
  };
}

function toggle(key, label, value, when) {
  return { key, label, type: 'toggle', value, when };
}

function chart(title, xLabel, yLabel, x, ...traces) {
  return {
    title, xLabel, yLabel,
    series: traces.map(([name, y]) => ({ name, x, y })),
  };
}

function randomGenerator(seed) {
  let state = Number(seed) >>> 0;
  return () => {
    state = (Math.imul(1664525, state) + 1013904223) >>> 0;
    return (state + 0.5) / 4294967296;
  };
}

function poisson(mean, random) {
  if (!(mean > 0)) return 0;
  if (mean >= 30) {
    const normal = Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random());
    return Math.max(0, Math.round(mean + normal * Math.sqrt(mean)));
  }
  let product = random();
  let events = 0;
  const limit = Math.exp(-mean);
  while (product > limit) {
    product *= random();
    events += 1;
  }
  return events;
}

const darkCounts = 17;
const referenceLines = [[405, 0.65], [436, 0.83], [546, 1], [578, 0.62], [630, 0.5]];
const sources = {
  triple: [[450, 0.69], [520, 1], [630, 0.76]],
  doublet: [[546, 0.55], [577, 1], [579, 0.82]],
};

export function arrayInputLines(settings = {}) {
  const source = settings.source ?? 'triple';
  const profile = settings.sampleProfile;
  if (source !== 'white' && (profile?.sourceType ?? source) === source && Array.isArray(profile?.sourceLines)) {
    const lines = profile.sourceLines.filter(line => Array.isArray(line) && line.length === 2 &&
      line.every(Number.isFinite) && line[0] > 0 && line[1] > 0);
    if (lines.length) return lines;
  }
  return sources[source];
}

const nominalIncidence = 15 * degrees;
const nominalBeta = Math.asin(550 * 600 / 1e6 - Math.sin(nominalIncidence));
export const ARRAY_OPTICS = {
  pixelCount: 768,
  pixelPitch: 0.028,
  focalLength: 60,
  nominalIncidence,
  nominalBeta,
};

const directionAt = angle => [Math.cos(angle), Math.sin(angle)];
const transverse = ([x, y]) => [-y, x];
const difference = ([x, y], [u, v]) => [x - u, y - v];
const projection = ([x, y], [u, v]) => x * u + y * v;
const advance = ([x, y], [u, v], distance) => [x + distance * u, y + distance * v];
const incomingAxis = directionAt(-nominalIncidence);
const outgoingAxis = directionAt(nominalBeta);
const slitAxis = transverse(incomingAxis);
const detectorAxis = transverse(outgoingAxis);
const nominalGrating = [423, 145];
const displayMm = 2.95;
const focusingDistance = ARRAY_OPTICS.focalLength * displayMm;
const collimatorDistance = 117;
const focusToDetector = focusingDistance * 1.02;
const detectorPixelSize = ARRAY_OPTICS.pixelPitch * focusToDetector / ARRAY_OPTICS.focalLength;
const nominalPositions = {
  fiber: advance(nominalGrating, incomingAxis, -359),
  slit: advance(nominalGrating, incomingAxis, -241),
  collimator: advance(nominalGrating, incomingAxis, -124),
  grating: nominalGrating,
  focus: advance(nominalGrating, outgoingAxis, focusingDistance * 0.81),
  detector: advance(nominalGrating, outgoingAxis, focusingDistance * 1.83),
};

export function arrayComponentPositions(settings = {}) {
  return Object.fromEntries(Object.entries(nominalPositions).map(([id, point]) => {
    const position = settings.positions?.[id];
    return [id, Number.isFinite(position?.x) && Number.isFinite(position?.y) ? [position.x, position.y] : [...point]];
  }));
}

function planeHit(origin, direction, center, normal) {
  const axialSpeed = projection(direction, normal);
  if (axialSpeed <= 1e-6) return null;
  const distance = projection(difference(center, origin), normal) / axialSpeed;
  return distance >= -1e-6 ? advance(origin, direction, distance) : null;
}

function traceArrayInput(settings, positions, slitOffset) {
  // These are the thin-lens focal distances calibrated against the nominal layout.
  const objectOffset = slitOffset * collimatorDistance / (1000 * ARRAY_OPTICS.focalLength);
  const slitPoint = advance(positions.slit, slitAxis, objectOffset);
  const launch = difference(slitPoint, positions.fiber);
  const axialLength = projection(launch, incomingAxis);
  const illumination = projection(difference(positions.slit, positions.fiber), slitAxis);
  const beamRadius = 12 + Math.max(0, axialLength) * 0.025;
  const points = [positions.fiber, slitPoint];
  if (axialLength <= 0 || Math.abs(illumination) > beamRadius * 3) return { points, weight: 0 };

  const collimatorHit = planeHit(slitPoint, launch, positions.collimator, incomingAxis);
  if (!collimatorHit) return { points, weight: 0 };
  points.push(collimatorHit);
  const height = projection(difference(collimatorHit, positions.collimator), slitAxis);
  if (Math.abs(height) > 30) return { points, weight: 0 };

  const slope = projection(launch, slitAxis) / axialLength - height / collimatorDistance;
  const incidentAngle = -nominalIncidence + Math.atan(slope) - 2 * (settings.alignment ?? 0) * degrees;
  const rotation = (settings.rotation ?? 0) * degrees;
  const gratingNormal = directionAt(-rotation);
  const gratingHit = planeHit(collimatorHit, directionAt(incidentAngle), positions.grating, gratingNormal);
  if (!gratingHit) return { points, weight: 0 };
  points.push(gratingHit);
  if (Math.abs(projection(difference(gratingHit, positions.grating), transverse(gratingNormal))) > 27) {
    return { points, weight: 0 };
  }

  return {
    points,
    gratingHit,
    incidence: rotation - incidentAngle,
    weight: gaussian(illumination, 0, beamRadius),
  };
}

function traceArrayOutput(settings, positions, input, wavelength) {
  const points = [...input.points];
  const miss = { pixel: NaN, detectorHit: false, points };
  if (!input.gratingHit) return miss;
  const rotation = (settings.rotation ?? 0) * degrees;
  const diffraction = wavelength * (settings.density ?? 600) / 1e6 - Math.sin(input.incidence);
  if (Math.abs(diffraction) >= 1) return miss;

  const diffracted = directionAt(Math.asin(diffraction) - rotation);
  const lensHit = planeHit(input.gratingHit, diffracted, positions.focus, outgoingAxis);
  if (!lensHit) return miss;
  points.push(lensHit);
  const lensHeight = projection(difference(lensHit, positions.focus), detectorAxis);
  if (Math.abs(lensHeight) > 57) return miss;

  const incidentSlope = projection(diffracted, detectorAxis) / projection(diffracted, outgoingAxis);
  const outgoingSlope = incidentSlope - lensHeight / focusToDetector;
  const focused = advance(outgoingAxis, detectorAxis, outgoingSlope);
  const ccdHit = planeHit(lensHit, focused, positions.detector, outgoingAxis);
  if (!ccdHit) return miss;
  points.push(ccdHit);
  const pixel = (ARRAY_OPTICS.pixelCount - 1) / 2 +
    projection(difference(ccdHit, positions.detector), detectorAxis) / detectorPixelSize;
  return { pixel, detectorHit: pixel >= 0 && pixel < ARRAY_OPTICS.pixelCount, points };
}

export function arrayDetectorHits(settings, wavelength) {
  const positions = arrayComponentPositions(settings);
  const slit = settings.slit ?? 70;
  const rayCount = 21;
  const weight = slit / (70 * rayCount);
  return Array.from({ length: rayCount }, (_, index) => {
    const offset = slit * ((index + 0.5) / rayCount - 0.5);
    const input = traceArrayInput(settings, positions, offset);
    return { wavelength, weight: weight * input.weight, offset, ...traceArrayOutput(settings, positions, input, wavelength) };
  });
}

function arrayWavelengthCalibration(settings) {
  const positions = arrayComponentPositions(settings);
  const input = traceArrayInput(settings, positions, 0);
  if (!input.gratingHit) return null;
  const gratingToLens = difference(positions.focus, input.gratingHit);
  const lensToDetector = difference(positions.detector, positions.focus);
  const focalPropagation = projection(lensToDetector, outgoingAxis);
  const lensFactor = 1 - focalPropagation / focusToDetector;
  const dispersion = focalPropagation + lensFactor * projection(gratingToLens, outgoingAxis);
  if (dispersion <= 1e-6) return null;
  const detectorOffset = projection(lensToDetector, detectorAxis) + lensFactor * projection(gratingToLens, detectorAxis);
  const rotation = (settings.rotation ?? 0) * degrees;
  return pixel => {
    const position = (pixel - (ARRAY_OPTICS.pixelCount - 1) / 2) * detectorPixelSize;
    const angle = Math.atan((position + detectorOffset) / dispersion) + nominalBeta + rotation;
    return (Math.sin(angle) + Math.sin(input.incidence)) * 1e6 / (settings.density ?? 600);
  };
}

function depositHits(bins, hits, intensity) {
  const detectorSigma = 0.65;
  for (const { pixel, weight, detectorHit } of hits) {
    if (!detectorHit) continue;
    const first = Math.max(0, Math.ceil(pixel - 3));
    const last = Math.min(bins.length - 1, Math.floor(pixel + 3));
    for (let index = first; index <= last; index += 1) {
      bins[index] += intensity * weight * gaussian(index, pixel, detectorSigma) /
        (detectorSigma * Math.sqrt(2 * Math.PI));
    }
  }
}

function arrayCalibration(settings, bins) {
  const positions = arrayComponentPositions(settings);
  const input = traceArrayInput(settings, positions, 0);
  const corrections = [];
  for (const [wavelength] of referenceLines) {
    const expected = traceArrayOutput(settings, positions, input, wavelength).pixel;
    const halfWidth = Math.ceil((settings.slit ?? 70) / 40) + 4;
    if (!(expected >= halfWidth && expected < bins.length - halfWidth)) continue;
    let area = 0;
    let moment = 0;
    for (let pixel = Math.round(expected) - halfWidth; pixel <= Math.round(expected) + halfWidth; pixel += 1) {
      area += bins[pixel];
      moment += bins[pixel] * pixel;
    }
    if (area > 1) corrections.push(moment / area - expected);
  }
  if (corrections.length < 2) return null;
  return {
    settings: { ...settings },
    correction: sum(corrections) / corrections.length,
    lines: corrections.length,
  };
}

function liveArrayHits(detector) {
  if (!detector || !(detector.width > 0)) return [];
  return detector.hits.map(hit => ({
    ...hit,
    pixel: (0.5 + hit.u / detector.width) * (ARRAY_OPTICS.pixelCount - 1),
    weight: hit.power,
    detectorHit: true,
  }));
}

function liveArrayCalibration(hits) {
  const anchors = [];
  for (const [wavelength] of referenceLines) {
    let power = 0;
    let moment = 0;
    for (const hit of hits) {
      if (hit.wavelength !== wavelength) continue;
      power += hit.weight;
      moment += hit.pixel * hit.weight;
    }
    if (power > 1e-8) anchors.push([moment / power, wavelength]);
  }
  anchors.sort(([a], [b]) => a - b);
  if (anchors.length < 2 || anchors.some(([pixel], i) => i > 0 && pixel - anchors[i - 1][0] < 0.5)) return null;
  const ascending = anchors.at(-1)[1] > anchors[0][1];
  if (anchors.some(([, wavelength], i) => i > 0 && (wavelength > anchors[i - 1][1]) !== ascending)) return null;
  return { anchors, lines: anchors.length };
}

function liveArrayWavelength(pixel, anchors) {
  let upper = anchors.findIndex(([position]) => position > pixel);
  upper = upper < 0 ? anchors.length - 1 : Math.max(1, upper);
  const [x1, y1] = anchors[upper - 1];
  const [x2, y2] = anchors[upper];
  return y1 + (pixel - x1) * (y2 - y1) / (x2 - x1);
}

function simulateArray(settings, ctx) {
  const { pixelCount } = ARRAY_OPTICS;
  const pixels = grid(0, pixelCount - 1, 1);
  const bins = new Float64Array(pixelCount);
  const referenceMode = ctx.mode === 'reference';
  const wavelengths = referenceMode ? referenceLines : arrayInputLines(settings);
  const coupling = ctx.coupling ?? 1;
  const detector = ctx.geometry?.arrayDetector;
  const lines = wavelengths ?? grid(380, 750, 2).map(wavelength => [
    wavelength, 0.19 * gaussian(wavelength, 582, 111) + 0.035,
  ]);
  const hits = [];
  if (ctx.mode !== 'dark') {
    if (detector) {
      hits.push(...liveArrayHits(detector));
      depositHits(bins, hits, ctx.geometry.arrayGain ?? 1300);
    } else {
      for (const [wavelength, intensity] of lines) {
        const lineHits = arrayDetectorHits(settings, wavelength);
        depositHits(bins, lineHits, 1300 * intensity * coupling);
        if (wavelengths || [450, 520, 630].includes(wavelength)) {
          for (const index of [0, 10, 20]) {
            hits.push({ ...lineHits[index], weight: lineHits[index].weight * intensity });
          }
        }
      }
    }
  }
  const calibration = referenceMode
    ? (detector ? liveArrayCalibration(hits) : arrayCalibration(settings, bins))
    : ctx.reference?.result?.calibration;
  const nominalCalibration = !calibration && detector ? liveArrayCalibration(liveArrayHits(ctx.geometry.arrayCalibration)) : null;
  const anchors = calibration?.anchors ?? nominalCalibration?.anchors;
  const calibrationSettings = calibration?.settings ?? { density: 600 };
  const wavelengthAtPixel = arrayWavelengthCalibration(calibrationSettings) ?? arrayWavelengthCalibration({});
  const calibratedWavelength = pixel => anchors ? liveArrayWavelength(pixel, anchors)
    : wavelengthAtPixel(pixel - (calibration?.correction ?? 0));
  const nm = pixels.map(calibratedWavelength);
  const raw = Array.from(bins, value => value + darkCounts);
  const index = peakIndex(bins);
  const peaksFound = sum(bins) > 0;
  let peakPixel = index;
  if (detector && peaksFound) {
    const first = Math.max(0, index - 2);
    const neighborhood = bins.slice(first, index + 3);
    peakPixel = first + neighborhood.reduce((moment, value, pixel) => moment + value * pixel, 0) / sum(neighborhood);
  }
  const peakWavelength = peaksFound ? calibratedWavelength(peakPixel) : undefined;
  return {
    charts: [
      chart('Raw CCD signal', 'Pixel', 'Counts', pixels, ['CCD', raw]),
      chart('Calibrated spectrum', 'Wavelength (nm)', 'Dark-corrected counts', nm, ['Spectrum', bins]),
    ],
    metrics: [
      { label: 'Peak pixel', value: peaksFound ? index : '—' },
      { label: 'Peak wavelength', value: format(peakWavelength, 1), unit: 'nm' },
      { label: 'Calibration lines', value: calibration?.lines ?? 'Nominal calibration' },
    ],
    calibration,
    peak: peakWavelength,
    bench: { hits, alignment: settings.alignment ?? 0 },
    note: referenceMode && !calibration
      ? 'Adjust the grating until the CCD resolves at least two reference lines.'
      : 'The CCD sums arriving rays by pixel. Reacquire the reference lamp spectrum after adjusting the grating.',
  };
}

const uvWavelengths = grid(300, 760, 1);
const uvDarkCounts = 31;
const defaultAbsorptionBands = [[405, 22, 0.78], [334, 17, 0.24]];
const defaultEmissionBands = [[520, 25, 1]];

function sampleBands(settings, name, fallback) {
  const bands = settings.sampleProfile?.[name];
  if (!Array.isArray(bands)) return fallback;
  return bands.filter(band => Array.isArray(band) && band.length === 3 &&
    band.every(Number.isFinite) && band[0] > 0 && band[1] > 0 && band[2] >= 0);
}

function bandProfile(wavelength, bands, broadening = 0) {
  let profile = 0;
  for (const [center, width, amplitude] of bands) {
    const broadened = Math.hypot(width, broadening);
    profile += amplitude * (width / broadened) * gaussian(wavelength, center, broadened);
  }
  return profile;
}

function lampResponse(wavelength) {
  return 0.48 + 0.45 * gaussian(wavelength, 510, 143);
}

function diffuseReflectance(wavelength) {
  return 0.51 + 0.13 * Math.tanh((wavelength - 500) / 55) - 0.22 * gaussian(wavelength, 410, 32);
}

function sampleTransmission(wavelength, settings, bands = sampleBands(settings, 'absorptionBands', defaultAbsorptionBands)) {
  const absorbance = (settings.concentration ?? 1) * (settings.pathLength ?? 1) * bandProfile(wavelength, bands);
  return 10 ** (-absorbance);
}

function integrateBand(wavelength, fwhm, evaluate) {
  const sigma = fwhm / fwhmToSigma;
  const offsets = [-2, -1, 0, 1, 2];
  let area = 0;
  let normalizer = 0;
  for (const offset of offsets) {
    const weight = Math.exp(-0.5 * offset ** 2);
    area += weight * evaluate(wavelength + sigma * offset);
    normalizer += weight;
  }
  return area / normalizer;
}

function sphereCollection(wallReflectance) {
  const detectorArea = 0.014;
  const portArea = 0.055;
  return detectorArea / (1 - (1 - portArea) * wallReflectance);
}

function simulateUvVis(settings, ctx) {
  const sphere = settings.mode === 'sphere';
  const referenceMode = ctx.mode === 'reference';
  const darkMode = ctx.mode === 'dark';
  const fwhm = settings.bandwidth ?? 2;
  const coupling = ctx.coupling ?? 1;
  const lamp = wavelength => 2900 * fwhm * coupling * spectralFactor(ctx, wavelength) * lampResponse(wavelength);
  const collection = sphere ? sphereCollection((settings.wall ?? 97) / 100) : 1;
  const standardR = 0.97;
  const stray = (settings.stray ?? 0) / 100;
  const absorptionBands = sampleBands(settings, 'absorptionBands', defaultAbsorptionBands);
  const mismatch = wavelength => settings.blank === 'mismatch' && !sphere
    ? 0.83 + 0.14 * (1 - gaussian(wavelength, 350, 45))
    : 1;
  const computeReference = wavelength => {
    const blank = sphere ? standardR : mismatch(wavelength);
    return uvDarkCounts + collection * integrateBand(wavelength, fwhm, lamp) * (blank + stray);
  };
  const expectedReference = uvWavelengths.map(computeReference);
  const savedReference = ctx.reference?.result?.referenceData;
  const usableReference = !referenceMode && savedReference?.kind === (sphere ? 'sphere' : 'transmission');
  const baseline = usableReference ? savedReference.counts : expectedReference;
  const measuredDark = ctx.dark?.result?.darkData;
  const raw = uvWavelengths.map((wavelength, index) => {
    if (darkMode) return uvDarkCounts;
    if (referenceMode) return expectedReference[index];
    const opticalSignal = integrateBand(wavelength, fwhm, lambda => {
      const specular = settings.specular === false ? 0 : 0.095;
      const response = sphere ? diffuseReflectance(lambda) + specular : sampleTransmission(lambda, settings, absorptionBands);
      return lamp(lambda) * (response + stray);
    });
    return uvDarkCounts + collection * opticalSignal;
  });
  const ratio = raw.map((value, index) => {
    const dark = measuredDark?.[index] ?? uvDarkCounts;
    const incident = baseline[index] - dark;
    return incident > 0 ? (value - dark) / incident : NaN;
  });
  const percent = ratio.map(value => value * 100 * (sphere ? standardR : 1));
  const absorbance = ratio.map(value => value > 0 ? -Math.log10(value) : NaN);
  const peak = peakIndex(absorbance);
  const hasPeak = !referenceMode && absorbance[peak] > 1e-5;
  const selected = uvWavelengths.indexOf(550);
  const traces = sphere
    ? chart('Integrating sphere reflectance', 'Wavelength (nm)', 'Reflectance (%)', uvWavelengths, ['Reflectance', percent])
    : chart('Absorbance spectrum', 'Wavelength (nm)', 'Absorbance (AU)', uvWavelengths, ['Absorbance', absorbance]);
  const metrics = sphere
    ? [
        { label: 'Reflectance at 550 nm', value: format(percent[selected], 1), unit: '%' },
        { label: 'Specular component', value: settings.specular === false ? 'Excluded' : 'Included' },
      ]
    : [
        { label: 'Absorption maximum', value: hasPeak ? uvWavelengths[peak] : '—', unit: 'nm' },
        { label: 'Peak absorbance', value: format(absorbance[peak], 3), unit: 'AU' },
        { label: 'Transmittance at peak', value: format(percent[peak], 1), unit: '%' },
      ];
  return {
    charts: [
      chart('Raw detector signal', 'Wavelength (nm)', 'Counts', uvWavelengths, [darkMode ? 'Dark' : 'Sample', raw], ['Reference', baseline]),
      traces,
    ],
    metrics: darkMode ? [{ label: 'Detector dark counts', value: uvDarkCounts }] : metrics,
    referenceData: referenceMode ? { kind: sphere ? 'sphere' : 'transmission', counts: raw } : undefined,
    darkData: darkMode ? raw : undefined,
    peak: !sphere && !darkMode && hasPeak ? uvWavelengths[peak] : undefined,
    note: sphere
      ? 'Reflectance is calibrated against the white standard. Toggle the specular component to compare collection modes.'
      : 'Transmittance is the ratio of dark-corrected sample and blank counts. Compare how stray light and a mismatched blank affect absorbance.',
  };
}

function emissionSensitivity(wavelength) {
  return 0.43 + 0.57 * gaussian(wavelength, 550, 124);
}

const emissionWavelengths = grid(350, 760, 2);
function simulatePL(settings, ctx) {
  const excitation = settings.excitation ?? 405;
  const fwhm = settings.bandwidth ?? 3;
  const duration = (settings.exposure ?? 200) / 1000;
  const excitationAbsorbed = 1 - sampleTransmission(excitation, settings);
  const hasSample = ctx.mode !== 'dark' && ctx.mode !== 'reference';
  const filter = settings.filter !== false;
  const coupling = ctx.coupling ?? 1;
  const excitationGain = ctx.geometry?.excitationCoupling ?? 1;
  const broadening = fwhm / fwhmToSigma;
  const emissionBands = sampleBands(settings, 'emissionBands', defaultEmissionBands);
  const excitationLeak = filter ? 0.004 : 1;
  const darkRate = 18;
  const detectorGain = emissionWavelengths.map(wavelength => fwhm / 3 * excitationGain * coupling * spectralFactor(ctx, wavelength));
  const emissionRate = emissionWavelengths.map((wavelength, index) => {
    const opticalFilter = filter && Math.abs(wavelength - excitation) < 8 ? 0.12 : 1;
    return hasSample
      ? 2100 * excitationAbsorbed * bandProfile(wavelength, emissionBands, broadening) * opticalFilter * detectorGain[index]
      : 0;
  });
  const signalRate = emissionWavelengths.map((wavelength, index) => {
    const scatter = ctx.mode === 'dark' ? 0 : 2700 * excitationLeak * gaussian(wavelength, excitation, Math.max(1.4, broadening));
    return emissionRate[index] + detectorGain[index] * scatter;
  });
  const random = randomGenerator(ctx.seed ?? 7);
  const raw = signalRate.map((value, i) => poisson((value * emissionSensitivity(emissionWavelengths[i]) + darkRate) * duration, random));
  const blank = ctx.reference?.result?.referenceData;
  const calibratedBlank = blank?.kind === 'pl' && blank.excitation === excitation &&
    blank.filter === filter && blank.fwhm === fwhm;
  const corrected = raw.map((count, i) => {
    const baseline = calibratedBlank && hasSample ? blank.rate[i] : darkRate;
    return (count / duration - baseline) / emissionSensitivity(emissionWavelengths[i]);
  });
  const activeBand = emissionWavelengths.map(wavelength => emissionBands.some(([center, width, amplitude]) =>
    amplitude > 0 && Math.abs(wavelength - center) <= 1.2 * width));
  const bandSignal = corrected.map((value, i) => activeBand[i] ? Math.max(0, value) : 0);
  const integrated = sum(bandSignal);
  const hasEmission = emissionRate.some((value, i) => activeBand[i] && value > 1e-9);
  const center = integrated && hasEmission
    ? sum(bandSignal.map((value, i) => value * emissionWavelengths[i])) / integrated
    : NaN;
  return {
    charts: [
      chart('Raw PMT signal', 'Emission wavelength (nm)', 'Counts', emissionWavelengths, ['Detector signal', raw]),
      chart('Emission spectrum', 'Emission wavelength (nm)', 'Corrected count rate (s⁻¹)', emissionWavelengths, ['Emission and scatter', corrected]),
    ],
    metrics: [
      { label: 'Emission band centroid', value: format(center, 1), unit: 'nm' },
      { label: 'Excitation absorbed', value: format(excitationAbsorbed * 100, 1), unit: '%' },
      { label: 'Total counts', value: sum(raw).toLocaleString('en-US') },
    ],
    referenceData: ctx.mode === 'reference' ? {
      kind: 'pl', excitation, filter, fwhm, rate: raw.map(count => count / duration),
    } : undefined,
    peak: Number.isFinite(center) ? Math.round(center) : undefined,
    note: 'Excitation within the absorption band increases emission. Disable the rejection filter to see scatter at the excitation wavelength.',
  };
}

function normalized(values) {
  const area = sum(values);
  return area > 0 ? values.map(value => value / area) : values;
}

function periodicDecay(irf, bin, lifetime) {
  const remaining = Math.exp(-bin / lifetime);
  const newPhoton = -Math.expm1(-bin / lifetime);
  let weightedHistory = 0;
  for (const value of irf) {
    weightedHistory = remaining * weightedHistory + newPhoton * value;
  }
  let history = weightedHistory / -Math.expm1(-irf.length * bin / lifetime);
  return irf.map(value => {
    history = remaining * history + newPhoton * value;
    return history;
  });
}

function fitDecay(observed, response, bin, background) {
  const amplitude = Math.max(0, sum(observed) - observed.length * background);
  if (amplitude < 10) return { lifetime: NaN, fitted: observed.map(() => background) };
  function error(lifetime) {
    const model = periodicDecay(response, bin, lifetime);
    return sum(model.map((value, i) => {
      const expected = Math.max(1e-8, amplitude * value + background);
      return expected - observed[i] * Math.log(expected);
    }));
  }
  const golden = (Math.sqrt(5) - 1) / 2;
  let lower = 0.12;
  let upper = observed.length * bin * 2;
  let a = upper - golden * (upper - lower);
  let b = lower + golden * (upper - lower);
  let errorA = error(a);
  let errorB = error(b);
  for (let i = 0; i < 27; i += 1) {
    if (errorA < errorB) {
      upper = b;
      b = a;
      errorB = errorA;
      a = upper - golden * (upper - lower);
      errorA = error(a);
    } else {
      lower = a;
      a = b;
      errorA = errorB;
      b = lower + golden * (upper - lower);
      errorB = error(b);
    }
  }
  const lifetime = (lower + upper) / 2;
  return {
    lifetime,
    fitted: periodicDecay(response, bin, lifetime).map(value => amplitude * value + background),
  };
}

function simulateTRPL(settings, ctx) {
  const repetition = settings.repetition ?? 20;
  const period = 1000 / repetition;
  const binCount = Math.round(period / 0.1);
  const bin = period / binCount;
  const time = Array.from({ length: binCount }, (_, index) => index * bin);
  const delayOffset = ctx.geometry?.trplDelayOffset ?? 0;
  const center = ((1.2 + delayOffset) % period + period) % period;
  const width = (settings.irf ?? 0.3) / fwhmToSigma;
  const response = normalized(time.map(value => {
    if (delayOffset === 0) return gaussian(value, 1.2, width);
    const separation = Math.abs(value - center);
    return gaussian(Math.min(separation, period - separation), 0, width);
  }));
  const referenceMode = ctx.mode === 'reference';
  const darkMode = ctx.mode === 'dark';
  const decay = periodicDecay(response, bin, settings.lifetime ?? 4);
  const wavelength = settings.excitation ?? 405;
  const detection = settings.detection ?? 520;
  const absorption = (1 - sampleTransmission(wavelength, settings)) / (1 - sampleTransmission(405, {}));
  const filter = 10 ** (-(settings.attenuation ?? 0));
  const excitationGain = ctx.geometry?.excitationCoupling ?? 1;
  const detectionGain = (ctx.coupling ?? 1) * spectralFactor(ctx, detection);
  const emissionBands = sampleBands(settings, 'emissionBands', defaultEmissionBands);
  const rate = (settings.flux ?? 1) / 100 * filter * detectionGain * excitationGain *
    absorption * bandProfile(detection, emissionBands);
  const liveGeometry = typeof ctx.spectralThroughput === 'function' || ctx.geometry?.excitationCoupling !== undefined;
  const referenceRate = 0.008 * (liveGeometry ? excitationGain * detectionGain : 1);
  const pulses = Math.round(repetition * (settings.exposure ?? 100) * 1000);
  const backgroundRate = 0.00008 / binCount;
  const background = backgroundRate * pulses;
  const random = randomGenerator(ctx.seed ?? 11);
  let cumulativeRate = 0;
  const counts = decay.map((value, i) => {
    if (darkMode) return poisson(background, random);
    const incident = (referenceMode ? referenceRate * response[i] : rate * value) + backgroundRate;
    const firstArrival = Math.exp(-cumulativeRate) * -Math.expm1(-incident);
    cumulativeRate += incident;
    return poisson(pulses * firstArrival, random);
  });
  const saved = ctx.reference?.result?.referenceData;
  const hasMeasuredIRF = saved?.kind === 'trpl' && saved.repetition === repetition;
  const fittingResponse = hasMeasuredIRF ? saved.response : response;
  const fit = !referenceMode && !darkMode
    ? fitDecay(counts, fittingResponse, bin, background)
    : { lifetime: NaN, fitted: counts.map(() => NaN) };
  const residuals = counts.map((count, i) => (count - fit.fitted[i]) / Math.sqrt(Math.max(1, fit.fitted[i])));
  const countTotal = sum(counts);
  const countFraction = countTotal / pulses;
  const scale = counts[peakIndex(counts)] / fittingResponse[peakIndex(fittingResponse)];
  const plottedIRF = fittingResponse.map(value => scale * value);
  const storedIRF = referenceMode ? normalized(counts.map(count => Math.max(0, count - background))) : undefined;
  let note = hasMeasuredIRF ? 'Reconvolution uses the measured instrument response function (IRF).' : 'The fit uses the nominal IRF. Acquire a reference trace to measure the scattering standard IRF.';
  if (countFraction > 0.05 && !referenceMode) {
    note = 'Pile-up favors early photons at high count rates. Increase attenuation to reduce the bias.';
  } else if (hasMeasuredIRF && Math.abs(delayOffset - (saved.delayOffset ?? 0)) > bin / 2) {
    note = 'The optical arrival time changed after the IRF scan. Acquire a fresh IRF at the current layout.';
  } else if (period < 5 * (settings.lifetime ?? 4)) {
    note = 'Emission from previous pulses persists across the repetition period. Reduce the laser repetition rate to compare.';
  }
  return {
    charts: [
      chart('TCSPC arrival-time histogram', 'Delay (ns)', 'Counts', time, ['Photon counts', counts], ['IRF (scaled for display)', plottedIRF], ['Reconvolution fit', fit.fitted]),
      chart('Fit residuals', 'Delay (ns)', 'Standardized residual', time, ['Residual', residuals]),
    ],
    metrics: [
      { label: 'Fitted lifetime', value: format(fit.lifetime), unit: 'ns' },
      { label: 'Detection probability', value: format(countFraction * 100, 2), unit: '% per pulse' },
      { label: 'Total photons', value: countTotal.toLocaleString('en-US') },
      ...(Math.abs(delayOffset) > 0.001 ? [{ label: 'Optical arrival shift', value: format(delayOffset, 3), unit: 'ns' }] : []),
    ],
    referenceData: referenceMode && referenceRate > 0 && sum(storedIRF) > 0
      ? { kind: 'trpl', repetition, delayOffset, response: storedIRF } : undefined,
    note,
  };
}

const ramanSamples = {
  silicon: [[520.7, 1, 4.5], [300, 0.09, 11], [960, 0.08, 31]],
  polymer: [[621, 0.32, 7], [1001, 1, 4.2], [1031, 0.48, 6], [1602, 0.58, 7], [3054, 0.72, 14]],
  carbon: [[1350, 0.78, 46], [1580, 1, 26], [2690, 0.43, 54]],
};

function simulateRaman(settings, ctx) {
  const laser = Number(settings.laser ?? 532);
  const filter = settings.filter !== false;
  const sample = ctx.mode === 'reference' ? 'silicon' : (settings.sample ?? 'silicon');
  const lines = ramanSamples[sample];
  const focus = 1 / (1 + ((settings.focus ?? 0) / 3.1) ** 2) ** 2;
  const excitation = (532 / laser) ** 4;
  const lastWavelength = 1 / (1 / laser - 3350 / 1e7);
  const firstWavelength = 1 / (1 / laser + 70 / 1e7);
  const alpha = Math.asin(firstWavelength * 600 / 1e6);
  const beta = Math.asin(lastWavelength * 600 / 1e6);
  const center = (alpha + beta) / 2;
  const rangeMin = Math.tan(alpha - center);
  const rangeMax = Math.tan(beta - center);
  const pixels = grid(0, ARRAY_OPTICS.pixelCount - 1, 1);
  const wavelength = pixels.map(pixel => {
    const theta = Math.atan(rangeMin + (rangeMax - rangeMin) * pixel / (pixels.length - 1)) + center;
    return Math.sin(theta) * 1e6 / 600;
  });
  const shift = wavelength.map(value => 1e7 * (1 / laser - 1 / value));
  const coupling = ctx.coupling ?? 1;
  const excitationGain = ctx.geometry?.excitationCoupling ?? 1;
  const darkMode = ctx.mode === 'dark';
  const raw = shift.map((value, i) => {
    if (darkMode) return darkCounts;
    const raman = sum(lines.map(([line, strength, width]) => strength * gaussian(value, line, width)));
    const rayleigh = (filter ? 0.006 : 8) * gaussian(value, 0, 7);
    const edge = filter ? 1 / (1 + Math.exp((96 - value) / 13)) : 1;
    return darkCounts + 1250 * excitation * excitationGain * coupling * spectralFactor(ctx, wavelength[i]) * focus * (raman * edge + rayleigh);
  });
  const corrected = raw.map(count => count - darkCounts);
  const strongest = lines[peakIndex(lines.map(([, strength]) => strength))][0];
  const ramanWavelength = 1 / (1 / laser - strongest / 1e7);
  const collection = focus * (ctx.spectralThroughput ? coupling * spectralFactor(ctx, ramanWavelength) : 1);
  const observedPeak = peakIndex(corrected);
  return {
    charts: [
      chart('Raw CCD signal', 'Detected wavelength (nm)', 'Counts', wavelength, ['CCD', raw]),
      chart('Raman spectrum', 'Raman shift (cm⁻¹)', 'Dark-corrected counts', shift, ['Raman', corrected]),
    ],
    metrics: [
      { label: 'Principal Raman band', value: format(strongest, 1), unit: 'cm⁻¹' },
      { label: 'Scattered wavelength', value: format(ramanWavelength, 2), unit: 'nm' },
      { label: 'Relative collection efficiency', value: format(collection * 100, 1), unit: '%' },
    ],
    peak: corrected[observedPeak] <= 0 ? undefined : ctx.spectralThroughput ? wavelength[observedPeak] : ramanWavelength,
    note: 'Change the laser wavelength to compare scattered wavelength and Raman shift. Adjust focus and Rayleigh rejection to observe their effect on the signal.',
  };
}

const sphereOnly = { key: 'mode', value: 'sphere' };
const transmissionOnly = { key: 'mode', value: 'transmission' };
export const opticalModels = {
  array: {
    controls: [
      select('source', 'Light source', 'triple', [['triple', 'Three-line source'], ['doublet', 'Close doublet'], ['white', 'Broadband lamp']]),
      range('slit', 'Entrance slit width', 70, 20, 500, 5, 'µm'),
      range('density', 'Grating groove density', 600, 450, 850, 25, 'lines/mm'),
      range('rotation', 'Grating rotation', 0, -8, 8, 0.1, '°'),
    ],
    simulate: simulateArray,
  },
  uv: {
    controls: [
      select('mode', 'Measurement geometry', 'transmission', [['transmission', 'Transmission (cuvette)'], ['sphere', 'Reflectance (integrating sphere)']]),
      range('concentration', 'Relative concentration', 1, 0, 2, 0.05, '×', transmissionOnly),
      range('pathLength', 'Cuvette path length', 1, 0.2, 2, 0.1, 'cm', transmissionOnly),
      select('blank', 'Blank solvent', 'matched', [['matched', 'Matched solvent'], ['mismatch', 'Mismatched solvent']], transmissionOnly),
      range('bandwidth', 'Spectral bandwidth', 2, 0.5, 18, 0.5, 'nm'),
      range('stray', 'Stray light fraction', 0, 0, 4, 0.1, '%'),
      toggle('specular', 'Include specular reflection', true, sphereOnly),
      range('wall', 'Sphere wall reflectance', 97, 85, 99, 0.5, '%', sphereOnly),
    ],
    simulate: simulateUvVis,
  },
  pl: {
    controls: [
      range('excitation', 'Excitation wavelength', 405, 350, 510, 1, 'nm'),
      range('concentration', 'Relative concentration', 1, 0, 2, 0.05, '×'),
      range('bandwidth', 'Emission bandwidth', 3, 1, 15, 0.5, 'nm'),
      range('exposure', 'Integration time per wavelength', 200, 50, 1000, 50, 'ms'),
      toggle('filter', 'Excitation rejection filter', true),
    ],
    simulate: simulatePL,
  },
  trpl: {
    controls: [
      range('excitation', 'Excitation wavelength', 405, 350, 510, 1, 'nm'),
      range('detection', 'Detection wavelength', 520, 445, 620, 1, 'nm'),
      range('lifetime', 'Simulated sample lifetime', 4, 0.5, 14, 0.1, 'ns'),
      range('repetition', 'Laser repetition rate', 20, 10, 80, 1, 'MHz'),
      range('irf', 'IRF full width at half maximum', 0.3, 0.15, 1.5, 0.05, 'ns'),
      range('flux', 'Incident photons per 100 pulses', 1, 0.5, 150, 0.5, ''),
      range('attenuation', 'Neutral-density attenuation', 0, 0, 2.5, 0.05, 'OD'),
      range('exposure', 'Acquisition time', 100, 25, 500, 25, 'ms'),
    ],
    simulate: simulateTRPL,
  },
  raman: {
    controls: [
      select('sample', 'Sample', 'silicon', [['silicon', 'Silicon'], ['polymer', 'Polystyrene'], ['carbon', 'Carbon film']]),
      select('laser', 'Laser wavelength', '532', [['532', '532 nm'], ['633', '633 nm'], ['785', '785 nm']]),
      range('focus', 'Axial focus offset', 0, -12, 12, 0.25, 'µm'),
      toggle('filter', 'Rayleigh rejection filter', true),
    ],
    simulate: simulateRaman,
  },
};
