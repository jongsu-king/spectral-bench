const DEG = Math.PI / 180;
const LIGHT_MM_PER_PS = 0.299792458;

function range(key, label, value, min, max, step, unit, when) {
  return { key, label, type: 'range', value, min, max, step, unit, when };
}

function toggle(key, label, value) {
  return { key, label, type: 'toggle', value };
}

function select(key, label, value, options) {
  return { key, label, type: 'select', value, options: options.map(([value, label]) => ({ value, label })) };
}

function chart(title, xLabel, yLabel, series, note) {
  return { title, xLabel, yLabel, series, note };
}

function points(count, at) {
  return Array.from({ length: count }, (_, index) => at(index));
}

function gaussian(x, center, width) {
  return Math.exp(-0.5 * ((x - center) / width) ** 2);
}

function couplingFor(ctx, mode = ctx.mode) {
  return mode === 'dark' ? 0 : (ctx.coupling ?? 1);
}

function rounded(value, digits = 2) {
  if (!Number.isFinite(value)) return '—';
  const roundedValue = Number(value.toFixed(digits));
  return roundedValue.toFixed(digits);
}

let nativeFftUnavailable = false;
let fftBackend = 'c';

export function setFftBackend(backend) {
  if (backend === fftBackend) return;
  fftBackend = backend;
  nativeFftUnavailable = false;
  latestIrBackground = undefined;
  latestThzWaves.clear();
  thzSource = undefined;
}

function nativeFft(real, imaginary, inverse) {
  if (nativeFftUnavailable || typeof window === 'undefined' || window.__SPECTRAL_DESKTOP__ !== true || typeof XMLHttpRequest !== 'function') {
    return false;
  }
  try {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/fft', false);
    request.setRequestHeader('Content-Type', 'application/json');
    request.send(JSON.stringify({ real: Array.from(real), imag: Array.from(imaginary), inverse, backend: fftBackend }));
    if (request.status !== 200) throw new Error('The selected FFT engine is unavailable.');
    const result = JSON.parse(request.responseText);
    if (result.real?.length !== real.length || result.imag?.length !== imaginary.length ||
      !result.real.every(Number.isFinite) || !result.imag.every(Number.isFinite)) {
      throw new Error('Invalid native FFT result');
    }
    real.set(result.real);
    imaginary.set(result.imag);
    return true;
  } catch (error) {
    if (fftBackend === 'matlab') throw error;
    nativeFftUnavailable = true;
    return false;
  }
}

// Radix-2 fallback uses the same convention as the desktop C implementation.
function fft(real, imaginary, inverse = false) {
  if (nativeFft(real, imaginary, inverse)) return;
  const length = real.length;
  for (let index = 1, reversed = 0; index < length; index += 1) {
    let bit = length >> 1;
    while (reversed & bit) {
      reversed ^= bit;
      bit >>= 1;
    }
    reversed ^= bit;
    if (index < reversed) {
      [real[index], real[reversed]] = [real[reversed], real[index]];
      [imaginary[index], imaginary[reversed]] = [imaginary[reversed], imaginary[index]];
    }
  }
  for (let block = 2; block <= length; block *= 2) {
    const step = (inverse ? 2 : -2) * Math.PI / block;
    const half = block / 2;
    for (let offset = 0; offset < half; offset += 1) {
      const cosine = Math.cos(step * offset);
      const sine = Math.sin(step * offset);
      for (let start = offset; start < length; start += block) {
        const end = start + half;
        const re = real[end] * cosine - imaginary[end] * sine;
        const im = real[end] * sine + imaginary[end] * cosine;
        real[end] = real[start] - re;
        imaginary[end] = imaginary[start] - im;
        real[start] += re;
        imaginary[start] += im;
      }
    }
  }
  if (inverse) {
    for (let index = 0; index < length; index += 1) {
      real[index] /= length;
      imaginary[index] /= length;
    }
  }
}

const add = ([ar, ai], [br, bi]) => [ar + br, ai + bi];
const subtract = ([ar, ai], [br, bi]) => [ar - br, ai - bi];
const multiply = ([ar, ai], [br, bi]) => [ar * br - ai * bi, ar * bi + ai * br];
const divide = ([ar, ai], [br, bi]) => {
  const power = br ** 2 + bi ** 2;
  return [(ar * br + ai * bi) / power, (ai * br - ar * bi) / power];
};
const polar = (amplitude, phase) => [amplitude * Math.cos(phase), amplitude * Math.sin(phase)];
const magnitude = ([real, imaginary]) => Math.hypot(real, imaginary);

const POLYMER_BANDS = {
  polystyrene: [[698, 12, 0.78], [756, 13, 0.59], [1028, 16, 0.23], [1452, 15, 0.36], [1493, 15, 0.55], [1601, 13, 0.69], [2924, 31, 0.34], [3026, 28, 0.55]],
  pet: [[725, 16, 0.58], [872, 15, 0.35], [1016, 18, 0.46], [1095, 27, 0.62], [1242, 27, 0.68], [1410, 18, 0.33], [1716, 26, 0.94], [2960, 37, 0.20]],
};

let latestIrBackground;

function irBackgroundScan(settings, opticalCoupling, maxOpdCm, opdOffset) {
  const key = [settings.mode, opticalCoupling, maxOpdCm, opdOffset].join('|');
  if (latestIrBackground?.key !== key) {
    latestIrBackground = { key, scan: irScan(settings, 'reference', opticalCoupling, maxOpdCm, opdOffset) };
  }
  return latestIrBackground.scan;
}

function irBackground(wavenumber, mode) {
  const edges = (1 - Math.exp(-((wavenumber / 420) ** 4))) * Math.exp(-((wavenumber / 4700) ** 6));
  const source = edges * (0.26 + 0.74 * gaussian(wavenumber, 2150, 1150));
  return source * (mode === 'atr' ? 0.82 : 1);
}

function atrDepth(wavenumber) {
  const diamondIndex = 2.4;
  const sampleIndex = 1.5;
  const incidence = 45 * DEG;
  const wavelengthMicrometers = 10_000 / wavenumber;
  return wavelengthMicrometers / (2 * Math.PI * diamondIndex * Math.sqrt(Math.sin(incidence) ** 2 - (sampleIndex / diamondIndex) ** 2));
}

function irScan(settings, mode, opticalCoupling, maxOpdCm, opdOffset) {
  const count = 4096;
  const wavenumberStep = 4;
  const opdStep = 1 / (count * wavenumberStep);
  const real = new Float64Array(count);
  const imaginary = new Float64Array(count);
  const bands = POLYMER_BANDS[settings.material] ?? POLYMER_BANDS.polystyrene;
  const isAtr = settings.mode === 'atr';
  for (let bin = 1; bin < count / 2; bin += 1) {
    const wavenumber = bin * wavenumberStep;
    const depth = isAtr ? atrDepth(wavenumber) / atrDepth(1500) * settings.contact / 100 : 1;
    const absorbance = bands.reduce((sum, [center, width, height]) => sum + height * gaussian(wavenumber, center, width), 0) * depth;
    const transmission = mode === 'sample' ? 10 ** -absorbance : 1;
    const intensity = opticalCoupling * irBackground(wavenumber, settings.mode) * transmission;
    const [re, im] = polar(intensity, 2 * Math.PI * wavenumber * opdOffset / 10_000);
    real[bin] = real[count - bin] = re;
    imaginary[bin] = im;
    imaginary[count - bin] = -im;
  }
  fft(real, imaginary, true);

  const opd = [];
  const interferogram = [];
  const halfScan = Math.floor(maxOpdCm / opdStep);
  for (let lag = -halfScan; lag <= halfScan; lag += 1) {
    const index = (lag + count) % count;
    opd.push(lag * opdStep * 10_000);
    interferogram.push(real[index]);
  }
  for (let index = 0; index < count; index += 1) {
    const lag = Math.min(index, count - index);
    const distance = lag * opdStep;
    const window = distance < maxOpdCm ? 0.5 + 0.5 * Math.cos(Math.PI * distance / maxOpdCm) : 0;
    real[index] *= window;
    imaginary[index] = 0;
  }
  fft(real, imaginary);
  const spectrum = real.map((value, index) => Math.hypot(value, imaginary[index]));
  return { opd, interferogram, spectrum };
}

function simulateFtir(settings, ctx) {
  const { mode = 'transmission', mirrorTravel = 320, contact = 90, material = 'polystyrene' } = settings;
  const current = { mode, mirrorTravel, contact, material };
  const maxOpdCm = 2 * mirrorTravel / 10_000;
  const opdOffset = ctx.geometry?.ftirOpdOffset ?? 0;
  const referenceOffset = ctx.reference ? (ctx.reference.geometry?.ftirOpdOffset ?? 0) : opdOffset;
  const previous = { ...current, ...ctx.reference?.settings };
  const gain = couplingFor(ctx);
  const reference = irBackgroundScan(previous, ctx.reference?.coupling ?? (ctx.coupling ?? 1), maxOpdCm, referenceOffset);
  const measurement = ctx.mode === 'reference'
    ? irBackgroundScan(current, gain, maxOpdCm, opdOffset)
    : irScan(current, ctx.mode ?? 'sample', gain, maxOpdCm, opdOffset);
  const wavenumbers = points(876, (index) => 500 + index * 4);
  const ratios = wavenumbers.map((wavenumber) => {
    const referencePower = reference.spectrum[wavenumber / 4];
    return gain > 0 && referencePower > 1e-8 ? Math.max(1e-8, measurement.spectrum[wavenumber / 4] / referencePower) : NaN;
  });
  const isAtr = mode === 'atr';
  const spectrum = ratios.map((value) => isAtr ? -Math.log10(value) : 100 * value);
  const showRatio = ctx.mode !== 'dark';
  const name = isAtr ? 'ATR absorbance' : 'Transmittance';
  const sourceName = ctx.mode === 'reference' ? 'Current background' : ctx.mode === 'dark' ? 'Dark signal' : 'Sample';
  const charts = [chart('Michelson interferogram', 'Optical path difference (µm)', 'AC detector signal (a.u.)', [
    { name: 'Background', x: reference.opd, y: reference.interferogram },
    { name: sourceName, x: measurement.opd, y: measurement.interferogram },
  ])];
  if (showRatio) {
    charts.push(chart('Background-corrected spectrum', 'Wavenumber (cm⁻¹)', isAtr ? 'Absorbance (a.u.)' : 'Transmittance (%)', [
      { name, x: wavenumbers, y: spectrum },
    ], 'Applies a Hann window to each interferogram, then divides the Fourier-transformed sample signal by the background.'));
  }
  const metrics = [
    { label: 'Maximum optical path difference', value: rounded(2 * mirrorTravel, 0), unit: 'µm' },
    { label: 'Nominal wavenumber resolution', value: rounded(1 / (2 * maxOpdCm), 1), unit: 'cm⁻¹' },
  ];
  if (isAtr) metrics.push({ label: 'Penetration depth at 1500 cm⁻¹', value: rounded(atrDepth(1500)), unit: 'µm' });
  if (Math.abs(opdOffset) > 0.001) metrics.push({ label: 'Optical path offset', value: rounded(opdOffset, 1), unit: 'µm' });
  if (Number.isFinite(ctx.geometry?.ftirArmVisibility)) {
    metrics.push({ label: 'Michelson fringe visibility', value: rounded(100 * ctx.geometry.ftirArmVisibility, 1), unit: '%' });
  }
  return { charts, metrics, note: ctx.mode !== 'dark' && gain === 0
    ? 'The detector records no modulated signal. Check the illumination and both Michelson arms.'
    : ctx.reference && previous.mode !== mode
    ? 'Acquire a fresh background in the current sampling mode.'
    : Math.abs(opdOffset - referenceOffset) > 0.001 ? 'The optical path changed after the background scan. Acquire a new background at the current geometry.'
      : isAtr ? 'Reduced contact with the diamond crystal weakens the measured absorption bands.'
      : 'Moving the mirror changes the optical path difference by twice its displacement.' };
}

function squareRoot([real, imaginary]) {
  const radius = Math.hypot(real, imaginary);
  return [Math.sqrt((radius + real) / 2), Math.sign(imaginary) * Math.sqrt((radius - real) / 2)];
}

function fresnel(admittance) {
  const [first, second, third] = admittance;
  return [divide(subtract(first, second), add(first, second)), divide(subtract(second, third), add(second, third))];
}

function reflectedFilm(wavelength, angle, thickness) {
  const direction = Math.sin(angle * DEG);
  const silica = [1.449 + 3400 / wavelength ** 2, 0];
  const silicon = [3.55 + 0.58 * (480 / wavelength) ** 2, 0.015 + 0.19 * Math.exp(-(wavelength - 400) / 85)];
  const squared = [[1, 0], silica, silicon].map((index) => multiply(index, index));
  const perpendicular = squared.map((index) => squareRoot(subtract(index, [direction ** 2, 0])));
  const filmPhase = 4 * Math.PI * thickness / wavelength;
  const roundTrip = polar(Math.exp(-filmPhase * perpendicular[1][1]), filmPhase * perpendicular[1][0]);
  const combine = ([front, back]) => {
    const shifted = multiply(back, roundTrip);
    return divide(add(front, shifted), add([1, 0], multiply(front, shifted)));
  };
  const rs = combine(fresnel(perpendicular));
  const rp = combine(fresnel(perpendicular.map((value, index) => divide(value, squared[index]))));
  return { rp, rs };
}

function ellipsometryPoint(wavelength, angle, thickness, analyzer) {
  const { rp, rs } = reflectedFilm(wavelength, angle, thickness);
  const powerP = magnitude(rp) ** 2 / 2;
  const powerS = magnitude(rs) ** 2 / 2;
  const cross = multiply(rp, [rs[0], -rs[1]]).map((value) => value / 2);
  const diagonalPower = (powerP + powerS) / 2 + cross[0];
  const circularPower = (powerP + powerS) / 2 + cross[1];
  const meanPower = (powerP + powerS) / 2;
  const rho = [(diagonalPower - meanPower) / powerS, (circularPower - meanPower) / powerS];
  const analyzerPower = powerP * Math.cos(analyzer) ** 2 + powerS * Math.sin(analyzer) ** 2 + cross[0] * Math.sin(2 * analyzer);
  return { rho, analyzerPower };
}

function fitFilmThickness(angle, thickness) {
  const observations = [angle - 5, angle, angle + 5].flatMap((angle) => [430, 475, 525, 580, 645, 715, 790].map((wavelength) => ({
    wavelength, angle, rho: ellipsometryPoint(wavelength, angle, thickness, 0).rho,
  })));
  const errorFor = (candidate) => observations.reduce((total, { wavelength, angle, rho }) => {
    const { rp, rs } = reflectedFilm(wavelength, angle, candidate);
    return total + magnitude(subtract(rho, divide(rp, rs))) ** 2;
  }, 0);
  let best = 0;
  let error = Infinity;
  const search = (start, end, step) => {
    for (let candidate = start; candidate <= end + 1e-8; candidate += step) {
      const candidateError = errorFor(candidate);
      if (candidateError < error) {
        best = candidate;
        error = candidateError;
      }
    }
  };
  search(0, 360, 3);
  search(Math.max(0, best - 3), best + 3, 0.25);
  return best;
}

function simulateEllipsometry(settings, ctx) {
  const { incidenceAngle: nominalAngle = 65, thickness = 120, analyzerAngle = 45 } = settings;
  const incidenceAngle = Math.min(84.9, Math.max(5, ctx.geometry?.incidenceAngle ?? nominalAngle));
  const sampleThickness = ctx.mode === 'reference' ? 0 : thickness;
  const wavelengths = points(101, (index) => 400 + index * 4);
  const angles = [incidenceAngle - 5, incidenceAngle, incidenceAngle + 5];
  const current = angles.map((angle) => wavelengths.map((wavelength) => ellipsometryPoint(wavelength, angle, sampleThickness, analyzerAngle * DEG)));
  const gain = couplingFor(ctx);
  const relativeThroughput = wavelengths.map(wavelength => ctx.spectralThroughput?.(wavelength) ?? 1);
  const raw = current[1].map(({ analyzerPower }, index) => analyzerPower * gain * relativeThroughput[index]);
  const intensity = [{ name: 'Analyzer signal', x: wavelengths, y: raw }];
  if (ctx.reference) {
    const previousAngle = ctx.reference.geometry?.incidenceAngle ?? ctx.reference.settings?.incidenceAngle ?? incidenceAngle;
    const previousAnalyzer = (ctx.reference.settings?.analyzerAngle ?? analyzerAngle) * DEG;
    const measured = ctx.reference.result?.referenceData;
    const reference = measured?.kind === 'ellipsometry' ? measured.counts
      : wavelengths.map((wavelength) => ellipsometryPoint(wavelength, previousAngle, 0, previousAnalyzer).analyzerPower * (ctx.reference.coupling ?? 1));
    intensity.push({ name: 'Bare silicon reference', x: wavelengths, y: reference });
  }
  const charts = [chart('Polarization analyzer signal', 'Wavelength (nm)', 'Relative intensity', intensity)];
  const canFit = gain * Math.max(...relativeThroughput) > 0.001;
  const angleLabels = angles.map(angle => Number(angle.toFixed(2)));
  if (canFit) {
    const angleSeries = (project) => current.map((values, index) => ({
      name: `${angleLabels[index]}° incidence`, x: wavelengths,
      y: values.map(({ rho }, i) => gain * relativeThroughput[i] > 0.001 ? project(rho) : NaN),
    }));
    charts.push(chart('Ellipsometric amplitude angle Ψ', 'Wavelength (nm)', 'Ψ (°)', angleSeries((rho) => Math.atan(magnitude(rho)) / DEG)));
    charts.push(chart('Ellipsometric phase difference Δ', 'Wavelength (nm)', 'Δ (°)', angleSeries(([re, im]) => (Math.atan2(im, re) / DEG + 360) % 360), 'Δ wraps at 360°.'));
  }
  return {
    charts,
    metrics: [
      { label: 'Fitted film thickness', value: canFit ? rounded(fitFilmThickness(incidenceAngle, sampleThickness), 1) : '—', unit: 'nm' },
      { label: 'Incidence angles', value: angleLabels.join(' / '), unit: '°' },
    ],
    referenceData: ctx.mode === 'reference' ? { kind: 'ellipsometry', counts: raw } : undefined,
    note: 'Uses synthetic SiO₂/Si optical constants and ideal polarization channels. Adjust the analyzer angle to change the detector signal.',
  };
}

function deltaAbsorbance(wavelength, time, excitation, bands) {
  const gate = 0.5 * (1 + Math.tanh(time / 0.135));
  const elapsed = Math.max(0, time);
  if (bands?.length) return excitation * gate * bands.reduce((sum, [center, sigma, magnitude, lifetime]) =>
    sum + magnitude * gaussian(wavelength, center, sigma) * Math.exp(-elapsed / lifetime), 0);
  const bleach = -0.021 * gaussian(wavelength, 521, 20) * Math.exp(-elapsed / 4.2);
  const excitedAbsorption = 0.029 * gaussian(wavelength, 646, 37) * Math.exp(-elapsed / 7.3);
  const hotCarrier = 0.010 * gaussian(wavelength, 460, 20) * Math.exp(-elapsed / 0.55);
  return excitation * gate * (bleach + excitedAbsorption + hotCarrier);
}

function simulateTa(settings, ctx) {
  const { delay = 0.8, offset = 0, pump = true, fluence = 30 } = settings;
  const wavelengths = points(111, (index) => 430 + index * 3);
  const delays = points(77, (index) => -1 + index * 0.2);
  const opticalOffset = ctx.geometry?.taOffset ?? 0;
  const delayOffset = ctx.geometry?.taDelayOffset ?? 0;
  const overlap = gaussian(offset + opticalOffset, 0, Math.hypot(42, 32));
  const illuminated = pump && (!ctx.mode || ctx.mode === 'sample');
  const pumpCoupling = ctx.geometry?.pumpCoupling ?? 1;
  const excitation = illuminated ? pumpCoupling * overlap * (1 - Math.exp(-fluence / 23)) : 0;
  const probeGain = couplingFor(ctx);
  const pumpOff = wavelengths.map((wavelength) => probeGain * (ctx.spectralThroughput?.(wavelength) ?? 1)
    * (0.20 + 0.80 * gaussian(wavelength, 565, 102)) * (1 - 0.13 * gaussian(wavelength, 522, 31)));
  const bands = settings.sampleProfile?.transientBands;
  const pumpOn = pumpOff.map((value, index) => value * 10 ** -deltaAbsorbance(wavelengths[index], delay - delayOffset, excitation, bands));
  const difference = pumpOn.map((value, index) => pumpOff[index] > 1e-10 ? -1000 * Math.log10(value / pumpOff[index]) : NaN);
  const map = delays.map((time) => wavelengths.map((wavelength, index) => pumpOff[index] > 1e-10
    ? 1000 * deltaAbsorbance(wavelength, time - delayOffset, excitation, bands) : 0));
  return {
    charts: [
      chart('Transmitted probe signal', 'Wavelength (nm)', 'Relative intensity', [
        { name: 'Pump off', x: wavelengths, y: pumpOff },
        { name: 'Pump on', x: wavelengths, y: pumpOn },
      ]),
      chart(`Transient absorption at ${rounded(delay, 1)} ps`, 'Wavelength (nm)', 'ΔA (mOD)', [{ name: 'ΔA', x: wavelengths, y: difference }]),
      { ...chart('Transient absorption map', 'Wavelength (nm)', 'Pump–probe delay (ps)', []), heatmap: { x: wavelengths, y: delays, z: map } },
    ],
    metrics: [
      { label: 'Pump–probe overlap', value: rounded(100 * overlap, 1), unit: '%' },
      { label: 'Delay stage displacement', value: rounded(delay * LIGHT_MM_PER_PS * 500, 1), unit: 'µm' },
      ...(Math.abs(opticalOffset) > 0.001 ? [{ label: 'Traced beam offset', value: rounded(opticalOffset, 1), unit: 'µm' }] : []),
      ...(Math.abs(delayOffset) > 0.001 ? [{ label: 'Traced time-zero shift', value: rounded(delayOffset, 3), unit: 'ps' }] : []),
      ...(pumpCoupling < 0.999 ? [{ label: 'Pump path throughput', value: rounded(pumpCoupling * 100, 1), unit: '%' }] : []),
    ],
    note: 'Displacing the beams reduces their overlap and weakens ΔA. Negative ΔA in this sample corresponds to ground-state bleaching.',
  };
}

const THZ_TIME_STEP = 0.05;
const THZ_SAMPLES = 4096;
const THZ_BIN = 1 / (THZ_SAMPLES * THZ_TIME_STEP);
const THZ_PULSE_CENTER = 6;
const latestThzWaves = new Map();
const latestThzSpectra = new WeakMap();
let thzSource;

function slabTransfer(frequency, index, absorption, thickness, echoes) {
  const phase = 2 * Math.PI * frequency * thickness / LIGHT_MM_PER_PS;
  const absorptionLength = absorption * thickness / 10;
  const direct = polar(4 * index / (1 + index) ** 2 * Math.exp(-absorptionLength / 2), -phase * (index - 1));
  if (!echoes) return direct;
  const reflection = ((index - 1) / (index + 1)) ** 2;
  const roundTrip = polar(reflection * Math.exp(-absorptionLength), -2 * phase * index);
  return divide(direct, subtract([1, 0], roundTrip));
}

function humidAir(frequency, humidity) {
  if (humidity === 0) return [1, 0];
  const lines = [[0.557, 0.017, 0.68], [0.752, 0.019, 0.41], [0.988, 0.021, 0.54], [1.113, 0.026, 0.48], [1.669, 0.023, 0.34]];
  // Conjugate pole pairs represent causal pressure-broadened absorption lines.
  const [loss, phase] = lines.reduce((sum, [center, width, depth]) => {
    const lower = divide([depth * width, 0], [width, frequency - center]);
    const upper = divide([depth * width, 0], [width, frequency + center]);
    return add(sum, add(lower, upper));
  }, [0, 0]);
  return polar(Math.exp(-humidity * loss / 100), -humidity * phase / 100);
}

function thzSourceSpectrum() {
  if (thzSource) return thzSource;
  const real = Float64Array.from({ length: THZ_SAMPLES }, (_, index) => {
    const time = index * THZ_TIME_STEP;
    return 4.8 * (gaussian(time, THZ_PULSE_CENTER, 0.31) - gaussian(time, THZ_PULSE_CENTER, 0.23))
      + 0.74 * (time - THZ_PULSE_CENTER) / 0.16 * gaussian(time, THZ_PULSE_CENTER, 0.16);
  });
  const imaginary = new Float64Array(THZ_SAMPLES);
  fft(real, imaginary);
  thzSource = { real, imaginary };
  return thzSource;
}

function thzWave(settings, mode, opticalCoupling, gateDelay) {
  if (opticalCoupling === 0) return new Float64Array(THZ_SAMPLES);
  const parameters = mode === 'sample' ? [settings.index, settings.absorption, settings.thickness, settings.echoes] : [];
  const key = [opticalCoupling, settings.humidity, gateDelay, ...parameters].join('|');
  const previous = latestThzWaves.get(mode);
  if (previous?.key === key) return previous.wave;
  const source = thzSourceSpectrum();
  const real = new Float64Array(THZ_SAMPLES);
  const imaginary = new Float64Array(THZ_SAMPLES);
  const upperBin = THZ_SAMPLES / 2;
  for (let bin = 0; bin <= upperBin; bin += 1) {
    const frequency = bin * THZ_BIN;
    const atmosphere = humidAir(frequency, settings.humidity);
    const sample = mode === 'sample' ? slabTransfer(frequency, settings.index, settings.absorption, settings.thickness, settings.echoes) : [1, 0];
    const incident = [source.real[bin] * opticalCoupling, source.imaginary[bin] * opticalCoupling];
    const gateShift = polar(1, 2 * Math.PI * frequency * gateDelay);
    const [re, im] = multiply(incident, multiply(atmosphere, multiply(sample, gateShift)));
    real[bin] = re;
    imaginary[bin] = bin === 0 || bin === upperBin ? 0 : im;
    if (bin > 0 && bin < upperBin) {
      real[THZ_SAMPLES - bin] = re;
      imaginary[THZ_SAMPLES - bin] = -im;
    }
  }
  fft(real, imaginary, true);
  latestThzWaves.set(mode, { key, wave: real });
  return real;
}

function thzSpectrum(wave, window) {
  const previous = latestThzSpectra.get(wave);
  if (previous?.window === window) return previous;
  const real = Float64Array.from(wave, (value, index) => {
    const time = index * THZ_TIME_STEP;
    if (time > window) return 0;
    const end = Math.min(1, (window - time) / 4);
    return value * (0.5 - 0.5 * Math.cos(Math.PI * end));
  });
  const imaginary = new Float64Array(THZ_SAMPLES);
  fft(real, imaginary);
  const spectrum = { window, real, imaginary };
  latestThzSpectra.set(wave, spectrum);
  return spectrum;
}

function pulseArrival(wave, window) {
  let peak = 1;
  for (let index = 2; index < Math.min(window / THZ_TIME_STEP, wave.length - 1); index += 1) {
    if (wave[index] > wave[peak]) peak = index;
  }
  const left = wave[peak - 1];
  const center = wave[peak];
  const right = wave[peak + 1];
  const offset = (left - right) / (2 * (left - 2 * center + right));
  return THZ_TIME_STEP * (peak + (Number.isFinite(offset) && Math.abs(offset) < 1 ? offset : 0));
}

function retrieveThz(frequency, measured, delay, thickness, echoes) {
  const phase = Math.atan2(measured[1], measured[0]);
  const phaseNearPulse = phase + 2 * Math.PI * Math.round((-2 * Math.PI * frequency * delay - phase) / (2 * Math.PI));
  let index = 1 - phaseNearPulse * LIGHT_MM_PER_PS / (2 * Math.PI * frequency * thickness);
  const measuredMagnitude = magnitude(measured);
  if (!Number.isFinite(index) || index < 0.5 || index > 3.6 || measuredMagnitude < 1e-7) return [NaN, NaN];
  const interfaceAmplitude = 4 * index / (1 + index) ** 2;
  let absorption = -20 / thickness * Math.log(measuredMagnitude / interfaceAmplitude);
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const model = slabTransfer(frequency, index, absorption, thickness, echoes);
    const [errorRe, errorIm] = subtract(measured, model);
    if (Math.hypot(errorRe, errorIm) < 1e-8) break;
    const [dnRe, dnIm] = subtract(slabTransfer(frequency, index + 1e-5, absorption, thickness, echoes), model).map((value) => value / 1e-5);
    const [daRe, daIm] = subtract(slabTransfer(frequency, index, absorption + 1e-3, thickness, echoes), model).map((value) => value / 1e-3);
    const determinant = dnRe * daIm - dnIm * daRe;
    if (Math.abs(determinant) < 1e-12 || !Number.isFinite(determinant)) break;
    index += (errorRe * daIm - errorIm * daRe) / determinant;
    absorption += (dnRe * errorIm - dnIm * errorRe) / determinant;
    if (!Number.isFinite(index) || !Number.isFinite(absorption) || index < 0.5 || index > 3.6 || absorption < -120 || absorption > 1000) return [NaN, NaN];
  }
  const residual = magnitude(subtract(slabTransfer(frequency, index, absorption, thickness, echoes), measured));
  return residual < 1e-3 ? [index, absorption] : [NaN, NaN];
}

function simulateThz(settings, ctx) {
  const { stage = 1170, thickness = 1, index = 1.5, absorption = 0, echoes = true, humidity = 0, window = 100 } = settings;
  const current = { stage, thickness, index, absorption, echoes, humidity, window };
  const previous = { ...current, humidity: 0, ...ctx.reference?.settings };
  const gateDelay = 2 * (ctx.geometry?.thzStageOffset ?? 0) / (LIGHT_MM_PER_PS * 1000);
  const referenceDelay = ctx.reference
    ? 2 * (ctx.reference.geometry?.thzStageOffset ?? 0) / (LIGHT_MM_PER_PS * 1000)
    : gateDelay;
  const gain = couplingFor(ctx);
  const reference = thzWave(previous, 'reference', ctx.reference?.coupling ?? (ctx.coupling ?? 1), referenceDelay);
  const measured = thzWave(current, ctx.mode ?? 'sample', gain, gateDelay);
  const isSample = !ctx.mode || ctx.mode === 'sample';
  const effectiveWindow = Math.min(window, ctx.reference?.settings?.window ?? window);
  const arrival = pulseArrival(measured, effectiveWindow) - pulseArrival(reference, effectiveWindow);
  const delayAtStage = 2 * stage / (LIGHT_MM_PER_PS * 1000);
  const sampled = measured[Math.round(delayAtStage / THZ_TIME_STEP)] ?? 0;
  const recordedCount = Math.min(THZ_SAMPLES, Math.floor(window / THZ_TIME_STEP) + 1);
  const plottedTime = points(recordedCount, (index) => index * THZ_TIME_STEP);
  const shownName = ctx.mode === 'reference' ? 'Current air reference' : ctx.mode === 'dark' ? 'Dark signal' : 'Sample';
  const charts = [chart('Time-domain electric field', 'Delay (ps)', 'E(t) (a.u.)', [
    { name: 'Air reference', x: plottedTime, y: reference.slice(0, recordedCount) },
    { name: shownName, x: plottedTime, y: measured.slice(0, recordedCount) },
    { name: 'Current delay position', x: [delayAtStage, delayAtStage], y: [-0.75, 1.4] },
  ], 'The optical delay stage sets the time at which the receiver samples the signed electric field.')];

  const metrics = [
    { label: 'Current delay', value: rounded(delayAtStage, 3), unit: 'ps' },
    { label: 'Sampled electric field', value: rounded(sampled, 3), unit: 'a.u.' },
    { label: 'Nominal frequency resolution', value: rounded(1 / effectiveWindow, 3), unit: 'THz' },
  ];
  if (Math.abs(gateDelay) > 0.001) metrics.push({ label: 'Gate path delay offset', value: rounded(gateDelay, 3), unit: 'ps' });
  if (Number.isFinite(ctx.geometry?.gateCoupling)) {
    metrics.push({ label: 'Optical gate throughput', value: rounded(100 * ctx.geometry.gateCoupling, 1), unit: '%' });
  }
  if (ctx.mode === 'dark') return { charts, metrics, note: 'The dark trace records the receiver signal with the optical path blocked.' };

  const referenceFrequency = thzSpectrum(reference, effectiveWindow);
  const measuredFrequency = thzSpectrum(measured, effectiveWindow);
  const maximum = Math.max(...referenceFrequency.real.map((real, bin) => Math.hypot(real, referenceFrequency.imaginary[bin])));
  const firstBin = Math.ceil(0.15 / THZ_BIN);
  const lastBin = Math.floor(3.5 / THZ_BIN);
  const frequencies = points(lastBin - firstBin + 1, (index) => (index + firstBin) * THZ_BIN);
  const indices = [];
  const absorptions = [];
  const amplitudes = [];
  const phases = [];
  let indexSum = 0;
  let absorptionSum = 0;
  let recoveredBins = 0;
  for (let bin = firstBin; bin <= lastBin; bin += 1) {
    const frequency = bin * THZ_BIN;
    const ref = [referenceFrequency.real[bin], referenceFrequency.imaginary[bin]];
    const obs = [measuredFrequency.real[bin], measuredFrequency.imaginary[bin]];
    const valid = maximum > 1e-9 && magnitude(ref) > maximum * 0.018 && magnitude(obs) > maximum * 0.004;
    const transfer = valid ? divide(obs, ref) : [NaN, NaN];
    const phase = Math.atan2(transfer[1], transfer[0]);
    amplitudes.push(magnitude(transfer));
    phases.push(phase + 2 * Math.PI * Math.round((-2 * Math.PI * frequency * arrival - phase) / (2 * Math.PI)));
    const [retrievedIndex, retrievedAbsorption] = isSample && valid
      ? retrieveThz(frequency, transfer, arrival, thickness, echoes) : [NaN, NaN];
    indices.push(retrievedIndex);
    absorptions.push(retrievedAbsorption);
    if (frequency > 0.40 && frequency < 1.40 && Number.isFinite(retrievedIndex)) {
      indexSum += retrievedIndex;
      absorptionSum += retrievedAbsorption;
      recoveredBins += 1;
    }
  }
  charts.push(chart('Sample-to-reference field amplitude', 'Frequency (THz)', '|E/E₀|', [{ name: 'Field amplitude ratio', x: frequencies, y: amplitudes }], 'Frequencies with weak sample or reference signals are masked.'));
  charts.push(chart('Sample-to-reference phase difference', 'Frequency (THz)', 'Phase (rad)', [{ name: 'Unwrapped phase', x: frequencies, y: phases }]));
  if (isSample) {
    charts.push(chart('Retrieved refractive index', 'Frequency (THz)', 'n', [{ name: 'Refractive index', x: frequencies, y: indices }]));
    charts.push(chart('Retrieved absorption coefficient', 'Frequency (THz)', 'α (cm⁻¹)', [{ name: 'Absorption coefficient', x: frequencies, y: absorptions }]));
    metrics.push({ label: 'Primary pulse delay', value: maximum > 1e-9 ? rounded(arrival, 2) : '—', unit: 'ps' });
    if (echoes) metrics.push({ label: 'First echo spacing (model)', value: rounded(2 * index * thickness / LIGHT_MM_PER_PS), unit: 'ps' });
    metrics.push({ label: 'Mean retrieved refractive index', value: rounded(indexSum / recoveredBins, 3) });
    metrics.push({ label: 'Mean retrieved absorption coefficient', value: rounded(absorptionSum / recoveredBins), unit: 'cm⁻¹' });
  }
  return {
    charts, metrics,
    note: gain === 0
      ? 'The receiver records no electric field. Check the emitter and optical gate paths.'
      : humidity !== previous.humidity
      ? 'Humidity differs between the sample and reference scans. Acquire a fresh air reference at the current humidity to remove residual water vapor lines.'
      : Math.abs(gateDelay - referenceDelay) > 0.001
        ? 'The gate path changed after the air reference. Acquire a new air reference to align the sample and reference time origins.'
        : 'The complex field ratio uses a shared time origin, Fresnel interface coefficients, and the selected internal-reflection model. Reported means use 0.40–1.40 THz.',
  };
}

export const advancedModels = {
  ftir: {
    controls: [
      select('mode', 'Sampling mode', 'transmission', [['transmission', 'Transmission'], ['atr', 'ATR']]),
      select('material', 'Simulated sample', 'polystyrene', [['polystyrene', 'Polystyrene'], ['pet', 'PET']]),
      range('mirrorTravel', 'Mirror scan range', 320, 60, 560, 10, 'µm'),
      range('contact', 'Crystal contact fraction', 90, 0, 100, 5, '%', { key: 'mode', value: 'atr' }),
    ],
    simulate: simulateFtir,
  },
  ellipsometry: {
    controls: [
      range('incidenceAngle', 'Nominal angle of incidence', 65, 45, 75, 1, '°'),
      range('thickness', 'SiO₂ film thickness', 120, 10, 340, 1, 'nm'),
      range('analyzerAngle', 'Analyzer angle', 45, 0, 180, 1, '°'),
    ],
    simulate: simulateEllipsometry,
  },
  ta: {
    controls: [
      range('delay', 'Pump–probe delay', 0.8, -1, 14, 0.1, 'ps'),
      range('offset', 'Pump–probe beam offset', 0, 0, 240, 5, 'µm'),
      toggle('pump', 'Enable pump', true),
      range('fluence', 'Pump fluence', 30, 0, 80, 1, 'µJ/cm²'),
    ],
    simulate: simulateTa,
  },
  thz: {
    controls: [
      range('stage', 'Delay stage position', 1170, 0, 1800, 10, 'µm'),
      range('thickness', 'Sample thickness', 1, 0.2, 2.5, 0.05, 'mm'),
      range('index', 'Simulated refractive index', 1.5, 1.1, 2.6, 0.01, ''),
      range('absorption', 'Simulated absorption coefficient', 0, 0, 30, 0.5, 'cm⁻¹'),
      toggle('echoes', 'Include internal reflections', true),
      range('humidity', 'Air humidity', 0, 0, 100, 5, '%'),
      range('window', 'Acquisition time window', 100, 40, 150, 5, 'ps'),
    ],
    simulate: simulateThz,
  },
};
